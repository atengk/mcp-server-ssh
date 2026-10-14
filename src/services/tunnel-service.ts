/**
 * SSH 本地端口转发与隧道生命周期管理服务
 *
 * @author Ateng
 * @since 2026-10-14
 */

import net from "node:net";
import type { ConnectionPool } from "../connection/pool.js";
import type {
  SSHForwardPortParams,
  SSHTunnelCloseParams,
  TunnelInfo,
} from "../types/tunnel.js";

/**
 * 活跃隧道内部运行实例
 */
interface ActiveTunnelInstance {
  tunnelId: string;
  type: "local" | "remote" | "socks5";
  connectionId: string;
  server?: net.Server;
  localHost: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  idleTimeoutSeconds: number;
  activeSockets: Set<net.Socket>;
  bytesTransferred: number;
  createdAt: Date;
  lastActiveAt: Date;
  idleTimer?: NodeJS.Timeout;
  cleanup?: () => Promise<void> | void;
}

/**
 * 隧道服务初始化配置选项
 */
export interface TunnelServiceOptions {
  connectionPool: ConnectionPool;
}

/**
 * 远程内网穿透与受管 SSH 端口转发服务
 */
export class TunnelService {
  private connectionPool: ConnectionPool;
  private tunnels = new Map<string, ActiveTunnelInstance>();
  private idCounter = 1;

  public constructor(options: TunnelServiceOptions) {
    this.connectionPool = options.connectionPool;

    // 监听物理连接断开事件，级联销毁对应的端口转发监听
    this.connectionPool.onDisconnect((connId) => {
      this.handleConnectionDisconnected(connId);
    });
  }

  /**
   * 建立新的 SSH 网络端口转发隧道（支持 local 正向、remote 反向与 socks5 动态代理）
   *
   * @param params 端口转发入参
   * @return 建立后的隧道元数据信息
   * @throws 物理连接不可达或端口冲突时抛出异常
   */
  public async openTunnel(params: SSHForwardPortParams): Promise<TunnelInfo> {
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      const lastErr = this.connectionPool.getLastConnectionError();
      const detail = lastErr ? `。最近一次建连失败原因: ${lastErr}` : "";
      throw new Error(`未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})${detail}`);
    }

    const tunnelId = `tunnel_${this.idCounter++}_${Date.now()}`;
    const type = params.type || "local";
    const localHost = params.localHost || "127.0.0.1";
    const remoteHost = params.remoteHost || "127.0.0.1";
    const remotePort = params.remotePort || 0;
    const idleTimeoutSeconds = params.idleTimeoutSeconds ?? 300;

    const instance: ActiveTunnelInstance = {
      tunnelId,
      type,
      connectionId: conn.id,
      localHost,
      localPort: params.localPort ?? 0,
      remoteHost,
      remotePort,
      idleTimeoutSeconds,
      activeSockets: new Set(),
      bytesTransferred: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    if (type === "remote") {
      // 模式 2：远程反向端口转发 (Remote Port Forwarding, -R)
      await new Promise<void>((resolve, reject) => {
        conn.client.forwardIn(remoteHost, remotePort, (err, bindPort) => {
          if (err) {
            return reject(new Error(`远程反向端口转发绑定失败 (${remoteHost}:${remotePort}): ${err.message}`));
          }
          if (typeof bindPort === "number") {
            instance.remotePort = bindPort;
          }
          resolve();
        });
      });

      const onTcpConnection = (info: any, accept: () => any, reject: () => void) => {
        if (info.destPort === instance.remotePort) {
          const stream = accept();
          const localSocket = net.connect(instance.localPort, instance.localHost, () => {
            localSocket.pipe(stream);
            stream.pipe(localSocket);
          });

          instance.activeSockets.add(localSocket);
          this.resetIdleTimer(instance);

          localSocket.on("data", (chunk) => {
            instance.bytesTransferred += chunk.length;
            instance.lastActiveAt = new Date();
            this.resetIdleTimer(instance);
          });

          stream.on("data", (chunk: Buffer) => {
            instance.bytesTransferred += chunk.length;
            instance.lastActiveAt = new Date();
            this.resetIdleTimer(instance);
          });

          const onDone = () => {
            instance.activeSockets.delete(localSocket);
            this.resetIdleTimer(instance);
          };

          localSocket.on("close", onDone);
          localSocket.on("error", onDone);
          stream.on("close", onDone);
          stream.on("error", onDone);
        }
      };

      conn.client.on("tcp connection", onTcpConnection);
      instance.cleanup = () => {
        if (typeof conn.client.removeListener === "function") {
          conn.client.removeListener("tcp connection", onTcpConnection);
        }
        if (typeof conn.client.unforwardIn === "function") {
          conn.client.unforwardIn(remoteHost, instance.remotePort, () => {});
        }
      };
    } else if (type === "socks5") {
      // 模式 3：本地动态 SOCKS5 代理 (Dynamic SOCKS5 Proxy, -D)
      const server = net.createServer((socket) => {
        instance.activeSockets.add(socket);
        instance.lastActiveAt = new Date();
        this.resetIdleTimer(instance);

        let stage = 0; // 0: 握手协商, 1: 请求转发, 2: 管道已建立

        socket.on("data", (data: Buffer) => {
          if (stage === 0) {
            // SOCKS5 握手包验证: [0x05, NMETHODS, METHODS...]
            if (data[0] !== 0x05) {
              socket.destroy();
              return;
            }
            // 回复无需认证: [0x05, 0x00]
            socket.write(Buffer.from([0x05, 0x00]));
            stage = 1;
          } else if (stage === 1) {
            // SOCKS5 连接请求包: [0x05, CMD, 0x00, ATYP, DST.ADDR, DST.PORT]
            if (data[0] !== 0x05 || data[1] !== 0x01) {
              // 仅支持 CMD 0x01 (CONNECT)
              socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              socket.destroy();
              return;
            }

            const atyp = data[3];
            let destHost = "";
            let destPort = 0;

            if (atyp === 0x01) {
              // IPv4 (4 字节)
              destHost = `${data[4]}.${data[5]}.${data[6]}.${data[7]}`;
              destPort = data.readUInt16BE(8);
            } else if (atyp === 0x03) {
              // 域名 (1 字节长度 + 字符串)
              const domainLen = data[4];
              destHost = data.slice(5, 5 + domainLen).toString("utf-8");
              destPort = data.readUInt16BE(5 + domainLen);
            } else if (atyp === 0x04) {
              // IPv6 (16 字节)
              destHost = data.slice(4, 20).toString("hex");
              destPort = data.readUInt16BE(20);
            } else {
              socket.write(Buffer.from([0x05, 0x08, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              socket.destroy();
              return;
            }

            const srcIP = socket.remoteAddress || "127.0.0.1";
            const srcPort = socket.remotePort || 0;

            conn.client.forwardOut(srcIP, srcPort, destHost, destPort, (err, stream: any) => {
              if (err) {
                socket.write(Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
                socket.destroy();
                return;
              }

              // 回复成功: [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]
              socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
              stage = 2;

              socket.on("data", (chunk) => {
                instance.bytesTransferred += chunk.length;
                instance.lastActiveAt = new Date();
                this.resetIdleTimer(instance);
              });

              stream.on("data", (chunk: Buffer) => {
                instance.bytesTransferred += chunk.length;
                instance.lastActiveAt = new Date();
                this.resetIdleTimer(instance);
              });

              socket.pipe(stream);
              stream.pipe(socket);

              const onSocketDone = () => {
                instance.activeSockets.delete(socket);
                this.resetIdleTimer(instance);
              };

              socket.on("close", onSocketDone);
              socket.on("error", onSocketDone);
              stream.on("close", onSocketDone);
              stream.on("error", onSocketDone);
            });
          }
        });
      });

      instance.server = server;

      await new Promise<void>((resolve, reject) => {
        server.listen(params.localPort ?? 0, localHost, () => {
          const address = server.address();
          if (address && typeof address === "object") {
            instance.localPort = address.port;
          }
          resolve();
        });
        server.on("error", (err) => {
          reject(new Error(`SOCKS5 本地代理监听启动失败 (${localHost}:${params.localPort ?? 0}): ${err.message}`));
        });
      });
    } else {
      // 模式 1：本地正向端口转发 (Local Port Forwarding, -L)
      const server = net.createServer((socket) => {
        instance.activeSockets.add(socket);
        instance.lastActiveAt = new Date();
        this.resetIdleTimer(instance);

        const srcIP = socket.remoteAddress || "127.0.0.1";
        const srcPort = socket.remotePort || 0;

        conn.client.forwardOut(srcIP, srcPort, remoteHost, remotePort, (err, stream: any) => {
          if (err) {
            console.error(
              `[mcp-server-ssh] 隧道 ${tunnelId} 建立远端通道失败 (${remoteHost}:${remotePort}): ${err.message}`
            );
            socket.destroy();
            return;
          }

          socket.on("data", (chunk) => {
            instance.bytesTransferred += chunk.length;
            instance.lastActiveAt = new Date();
            this.resetIdleTimer(instance);
          });

          stream.on("data", (chunk: Buffer) => {
            instance.bytesTransferred += chunk.length;
            instance.lastActiveAt = new Date();
            this.resetIdleTimer(instance);
          });

          socket.pipe(stream);
          stream.pipe(socket);

          const onSocketDone = () => {
            instance.activeSockets.delete(socket);
            this.resetIdleTimer(instance);
          };

          socket.on("close", onSocketDone);
          socket.on("error", onSocketDone);
          stream.on("close", onSocketDone);
          stream.on("error", onSocketDone);
        });
      });

      instance.server = server;

      await new Promise<void>((resolve, reject) => {
        server.listen(params.localPort ?? 0, localHost, () => {
          const address = server.address();
          if (address && typeof address === "object") {
            instance.localPort = address.port;
          }
          resolve();
        });

        server.on("error", (err) => {
          reject(new Error(`本地隧道监听启动失败 (${localHost}:${params.localPort ?? 0}): ${err.message}`));
        });
      });
    }

    this.tunnels.set(tunnelId, instance);
    this.resetIdleTimer(instance);

    return this.toTunnelInfo(instance);
  }

  /**
   * 关闭指定的端口转发隧道
   *
   * @param params 关闭参数
   * @return 关闭操作状态
   */
  public async closeTunnel(params: SSHTunnelCloseParams): Promise<{ tunnelId: string; closed: boolean }> {
    const instance = this.tunnels.get(params.tunnelId);
    if (!instance) {
      return { tunnelId: params.tunnelId, closed: false };
    }

    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
    }

    if (instance.cleanup) {
      try {
        await instance.cleanup();
      } catch {}
    }

    for (const socket of instance.activeSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    instance.activeSockets.clear();

    if (instance.server) {
      await new Promise<void>((resolve) => {
        instance.server!.close(() => resolve());
      });
    }

    this.tunnels.delete(params.tunnelId);
    return { tunnelId: params.tunnelId, closed: true };
  }

  /**
   * 列出当前所有活跃的端口转发隧道
   *
   * @return 活跃端口转发隧道列表（无活跃时返回空数组）
   */
  public listTunnels(): TunnelInfo[] {
    const list: TunnelInfo[] = [];
    for (const instance of this.tunnels.values()) {
      list.push(this.toTunnelInfo(instance));
    }
    return list;
  }

  /**
   * 优雅关闭并释放所有端口转发隧道
   */
  public async closeAll(): Promise<void> {
    const keys = Array.from(this.tunnels.keys());
    for (const key of keys) {
      await this.closeTunnel({ tunnelId: key });
    }
  }

  /**
   * 重置空闲超时熔断定时器
   */
  private resetIdleTimer(instance: ActiveTunnelInstance): void {
    if (instance.idleTimer) {
      clearTimeout(instance.idleTimer);
      instance.idleTimer = undefined;
    }

    if (instance.idleTimeoutSeconds > 0) {
      instance.idleTimer = setTimeout(() => {
        if (instance.activeSockets.size === 0) {
          console.error(
            `[mcp-server-ssh] 隧道 ${instance.tunnelId} 已空闲超过 ${instance.idleTimeoutSeconds} 秒，自动熔断释放本地端口 ${instance.localPort}`
          );
          this.closeTunnel({ tunnelId: instance.tunnelId }).catch(() => {});
        }
      }, instance.idleTimeoutSeconds * 1000);
    }
  }

  /**
   * 处理底层物理 SSH 连接断开，级联释放关联的所有隧道
   */
  private handleConnectionDisconnected(connectionId: string): void {
    for (const [id, instance] of this.tunnels.entries()) {
      if (instance.connectionId === connectionId) {
        console.error(
          `[mcp-server-ssh] 检测到物理连接 ${connectionId} 已断开，正在级联释放隧道 ${id}`
        );
        this.closeTunnel({ tunnelId: id }).catch(() => {});
      }
    }
  }

  /**
   * 转换为领域模型 TunnelInfo
   */
  private toTunnelInfo(instance: ActiveTunnelInstance): TunnelInfo {
    return {
      tunnelId: instance.tunnelId,
      type: instance.type,
      localHost: instance.localHost,
      localPort: instance.localPort,
      remoteHost: instance.remoteHost,
      remotePort: instance.remotePort,
      connectionId: instance.connectionId,
      activeSockets: instance.activeSockets.size,
      bytesTransferred: instance.bytesTransferred,
      createdAt: instance.createdAt.toISOString(),
      lastActiveAt: instance.lastActiveAt.toISOString(),
      idleTimeoutSeconds: instance.idleTimeoutSeconds,
    };
  }
}

