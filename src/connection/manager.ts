/**
 * SSH 多主机连接池管理器
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { Client, type ConnectConfig } from "ssh2";
import type { ConnectionInfo, SSHConnectParams } from "../types/connection.js";
import { SSHConfigParser } from "./config-parser.js";
import { CredentialResolver } from "./credentials.js";

/**
 * 受管连接内部实例对象
 */
export interface ManagedConnection {
  id: string;
  client: Client;
  info: ConnectionInfo;
  jumpClient?: Client;
}

/**
 * 连接池初始化选项
 */
export interface ConnectionPoolOptions {
  clientFactory?: () => Client;
  configParser?: SSHConfigParser;
  credentialResolver?: CredentialResolver;
}

/**
 * SSH 多主机连接池与路由管理器
 */
export class ConnectionPool {
  private connections = new Map<string, ManagedConnection>();
  private defaultConnectionId: string | null = null;
  private idCounter = 1;
  private clientFactory: () => Client;
  private configParser: SSHConfigParser;
  private credentialResolver: CredentialResolver;

  public constructor(options?: ConnectionPoolOptions) {
    this.clientFactory = options?.clientFactory ?? (() => new Client());
    this.configParser = options?.configParser ?? new SSHConfigParser();
    this.credentialResolver = options?.credentialResolver ?? new CredentialResolver();
  }

  /**
   * 建立新的 SSH 连接并加入连接池
   *
   * @param params 业务连接参数
   * @return 建立后的连接信息对象
   * @throws 当网络连接超时、鉴权失败或跳板机不可达时抛出异常
   */
  public async connect(params: SSHConnectParams): Promise<ConnectionInfo> {
    // 1. 若指定了 Host 别名，优先从 ~/.ssh/config 继承配置
    let effectiveParams: SSHConnectParams = { ...params };
    if (params.sshConfigAlias) {
      const aliasConfig = this.configParser.resolveHost(params.sshConfigAlias);
      if (aliasConfig) {
        effectiveParams = { ...aliasConfig, ...params };
      }
    }

    if (!effectiveParams.host) {
      throw new Error("无法建立连接：未指定目标主机地址 (host) 且别名解析失败");
    }

    // 2. 生成或确定 connectionId
    const connectionId = effectiveParams.connectionId || `conn_${this.idCounter++}`;

    // 若已存在同名活跃连接，先安全断开旧连接
    if (this.connections.has(connectionId)) {
      await this.disconnect(connectionId);
    }

    // 3. 处理 ProxyJump 堡垒机跳板中继
    let jumpClient: Client | undefined;
    let streamSocket: any;

    if (effectiveParams.proxyJump) {
      const jumpTarget = this.parseProxyJumpTarget(effectiveParams.proxyJump);
      const jumpCreds = await this.credentialResolver.resolve(jumpTarget);

      jumpClient = await this.createClientInstance(jumpCreds);

      // 通过跳板机发起 direct-tcpip 隧道转发
      streamSocket = await new Promise((resolve, reject) => {
        jumpClient!.forwardOut(
          "127.0.0.1",
          12345,
          effectiveParams.host!,
          effectiveParams.port || 22,
          (err, stream) => {
            if (err) {
              reject(new Error(`跳板机隧道转发建立失败 (${effectiveParams.proxyJump}): ${err.message}`));
            } else {
              resolve(stream);
            }
          }
        );
      });
    }

    // 4. 解析目标主机的认证凭据与底层连接配置
    const targetConfig = await this.credentialResolver.resolve(effectiveParams);
    if (streamSocket) {
      targetConfig.sock = streamSocket;
    }

    // 5. 建立最终目标主机连接
    const client = await this.createClientInstance(targetConfig);

    // 6. 监听断开与异常事件以实施连接池自愈与清理
    client.on("close", () => {
      this.handleConnectionClosed(connectionId);
    });
    client.on("error", (err) => {
      process.stderr.write(`[mcp-server-ssh] 连接 ${connectionId} 发生异常: ${err.message}\n`);
    });

    const now = new Date().toISOString();
    const shouldSetDefault = effectiveParams.setAsDefault ?? (this.defaultConnectionId === null);

    const info: ConnectionInfo = {
      connectionId,
      host: effectiveParams.host,
      port: effectiveParams.port || 22,
      username: targetConfig.username || "root",
      isDefault: shouldSetDefault,
      connectedAt: now,
      lastActiveAt: now,
    };

    const managed: ManagedConnection = {
      id: connectionId,
      client,
      info,
      jumpClient,
    };

    this.connections.set(connectionId, managed);

    if (shouldSetDefault) {
      this.setDefaultConnection(connectionId);
    }

    return info;
  }

  /**
   * 关闭并移除指定的连接
   *
   * @param connectionId 待关闭的连接标识
   * @return 是否成功关闭已有连接
   */
  public async disconnect(connectionId: string): Promise<boolean> {
    const conn = this.connections.get(connectionId);
    if (!conn) {
      return false;
    }

    try {
      conn.client.end();
    } catch {}

    if (conn.jumpClient) {
      try {
        conn.jumpClient.end();
      } catch {}
    }

    this.connections.delete(connectionId);

    // 若关闭的是当前默认连接，则尝试切换至剩余连接中的第一个
    if (this.defaultConnectionId === connectionId) {
      const remainingKeys = Array.from(this.connections.keys());
      if (remainingKeys.length > 0) {
        this.setDefaultConnection(remainingKeys[0]);
      } else {
        this.defaultConnectionId = null;
      }
    }

    return true;
  }

  /**
   * 列出当前所有活跃连接状态
   *
   * @return 活跃连接列表
   */
  public listConnections(): ConnectionInfo[] {
    const list: ConnectionInfo[] = [];
    for (const [id, conn] of this.connections.entries()) {
      list.push({
        ...conn.info,
        isDefault: id === this.defaultConnectionId,
      });
    }
    return list;
  }

  /**
   * 获取指定的连接实例；若未指定 connectionId 则自动路由到默认连接
   *
   * @param connectionId 可选连接标识
   * @return 受管连接实例或 undefined
   */
  public getConnection(connectionId?: string): ManagedConnection | undefined {
    const targetId = connectionId || this.defaultConnectionId;
    if (!targetId) {
      return undefined;
    }
    const conn = this.connections.get(targetId);
    if (conn) {
      conn.info.lastActiveAt = new Date().toISOString();
    }
    return conn;
  }

  /**
   * 将指定连接设为默认活跃连接
   *
   * @param connectionId 连接标识
   * @return 是否设置成功
   */
  public setDefaultConnection(connectionId: string): boolean {
    if (!this.connections.has(connectionId)) {
      return false;
    }
    this.defaultConnectionId = connectionId;
    for (const [id, conn] of this.connections.entries()) {
      conn.info.isDefault = id === connectionId;
    }
    return true;
  }

  /**
   * 关闭所有活跃连接与跳板机
   */
  public async closeAll(): Promise<void> {
    const keys = Array.from(this.connections.keys());
    for (const key of keys) {
      await this.disconnect(key);
    }
  }

  /**
   * 底层通过 Promise 包装异步建连过程
   */
  private createClientInstance(config: ConnectConfig): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = this.clientFactory();
      let isSettled = false;

      const onReady = () => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          resolve(client);
        }
      };

      const onError = (err: Error) => {
        if (!isSettled) {
          isSettled = true;
          cleanup();
          reject(err);
        }
      };

      const cleanup = () => {
        client.removeListener("ready", onReady);
        client.removeListener("error", onError);
      };

      client.once("ready", onReady);
      client.once("error", onError);

      try {
        client.connect(config);
      } catch (err) {
        onError(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * 解析 ProxyJump 字符串为连接参数（如 "bastion" 或 "user@10.0.0.1:2222"）
   */
  private parseProxyJumpTarget(proxyJump: string): SSHConnectParams {
    const aliasResolved = this.configParser.resolveHost(proxyJump);
    if (aliasResolved) {
      return aliasResolved;
    }

    // 格式: [user@]host[:port]
    let remaining = proxyJump;
    let username: string | undefined;
    if (remaining.includes("@")) {
      const parts = remaining.split("@");
      username = parts[0];
      remaining = parts[1];
    }

    let host = remaining;
    let port = 22;
    if (remaining.includes(":")) {
      const parts = remaining.split(":");
      host = parts[0];
      port = Number.parseInt(parts[1], 10) || 22;
    }

    return {
      host,
      port,
      username,
      setAsDefault: false,
    };
  }

  /**
   * 处理远端主动关闭连接事件
   */
  private handleConnectionClosed(connectionId: string): void {
    if (this.connections.has(connectionId)) {
      this.connections.delete(connectionId);
      if (this.defaultConnectionId === connectionId) {
        const remainingKeys = Array.from(this.connections.keys());
        this.defaultConnectionId = remainingKeys.length > 0 ? remainingKeys[0] : null;
      }
    }
  }
}
