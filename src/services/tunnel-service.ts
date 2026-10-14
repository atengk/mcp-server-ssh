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
  connectionId: string;
  server: net.Server;
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
   * 建立新的 SSH 本地端口转发隧道
   *
   * @param params 端口转发入参
   * @return 建立后的隧道元数据信息
   * @throws 物理连接不可达或本地端口冲突时抛出异常
   */
  public async openTunnel(params: SSHForwardPortParams): Promise<TunnelInfo> {
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      const lastErr = this.connectionPool.getLastConnectionError();
      const detail = lastErr ? `。最近一次建连失败原因: ${lastErr}` : "";
      throw new Error(`未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})${detail}`);
    }

    const tunnelId = `tunnel_${this.idCounter++}_${Date.now()}`;
    const localHost = params.localHost || "127.0.0.1";
    const remoteHost = params.remoteHost || "127.0.0.1";
    const remotePort = params.remotePort;
    const idleTimeoutSeconds = params.idleTimeoutSeconds ?? 300;

    const instance: ActiveTunnelInstance = {
      tunnelId,
      connectionId: conn.id,
      server: null as any,
      localHost,
      localPort: 0,
      remoteHost,
      remotePort,
      idleTimeoutSeconds,
      activeSockets: new Set(),
      bytesTransferred: 0,
      createdAt: new Date(),
      lastActiveAt: new Date(),
    };

    const server = net.createServer((socket) => {
      instance.activeSockets.add(socket);
      instance.lastActiveAt = new Date();
      this.resetIdleTimer(instance);

      const srcIP = socket.remoteAddress || "127.0.0.1";
      const srcPort = socket.remotePort || 0;

      // 依托底层 SSH 物理连接发起 forwardOut 通道建立
      conn.client.forwardOut(srcIP, srcPort, remoteHost, remotePort, (err, stream) => {
        if (err) {
          process.stderr.write(
            `[mcp-server-ssh] 隧道 ${tunnelId} 建立远端通道失败 (${remoteHost}:${remotePort}): ${err.message}\n`
          );
          socket.destroy();
          return;
        }

        // 双向流管道转发
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

    // 启动本地监听
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

    // 终止所有当前代理客户端连接
    for (const socket of instance.activeSockets) {
      try {
        socket.destroy();
      } catch {}
    }
    instance.activeSockets.clear();

    await new Promise<void>((resolve) => {
      instance.server.close(() => resolve());
    });

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
          process.stderr.write(
            `[mcp-server-ssh] 隧道 ${instance.tunnelId} 已空闲超过 ${instance.idleTimeoutSeconds} 秒，自动熔断释放本地端口 ${instance.localPort}\n`
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
        process.stderr.write(
          `[mcp-server-ssh] 检测到物理连接 ${connectionId} 已断开，正在级联释放隧道 ${id}\n`
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
