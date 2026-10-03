/**
 * 远程持久 PTY 交互式终端会话服务
 *
 * @author Ateng
 * @since 2026-10-03
 */

import type { ClientChannel } from "ssh2";
import type { ConnectionPool } from "../connection/manager.js";
import { SafetyGuard } from "../security/guard.js";
import { OutputTruncator } from "../security/truncator.js";
import type {
  SSHSessionCloseParams,
  SSHSessionSendParams,
  SSHSessionStartParams,
} from "../types/exec.js";

/**
 * 活跃 PTY 终端会话内部数据结构
 */
interface ActivePTYSession {
  sessionId: string;
  connectionId: string;
  stream: ClientChannel;
  buffer: string[];
  createdAt: Date;
}

/**
 * PTY 会话服务配置选项
 */
export interface SessionServiceOptions {
  connectionPool: ConnectionPool;
  safetyGuard?: SafetyGuard;
  outputTruncator?: OutputTruncator;
}

/**
 * 远程交互式伪终端 (PTY) 会话服务
 */
export class SessionService {
  private connectionPool: ConnectionPool;
  private safetyGuard: SafetyGuard;
  private outputTruncator: OutputTruncator;
  private sessions = new Map<string, ActivePTYSession>();
  private idCounter = 1;

  public constructor(options: SessionServiceOptions) {
    this.connectionPool = options.connectionPool;
    this.safetyGuard = options.safetyGuard ?? new SafetyGuard();
    this.outputTruncator = options.outputTruncator ?? new OutputTruncator();
  }

  /**
   * 启动新的持久交互式 PTY 伪终端会话
   *
   * @param params 启动终端会话入参
   * @return 分配的 sessionId
   */
  public async startSession(params: SSHSessionStartParams): Promise<{ sessionId: string }> {
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      const lastErr = this.connectionPool.getLastConnectionError();
      const detail = lastErr ? `。最近一次尝试建连失败原因: ${lastErr}` : "";
      throw new Error(
        `未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})${detail}，请先通过 ssh_connect 建立连接`
      );
    }

    const sessionId = `pty_${this.idCounter++}_${Date.now()}`;
    const cols = params.cols || 120;
    const rows = params.rows || 30;

    return new Promise<{ sessionId: string }>((resolve, reject) => {
      conn.client.shell(
        {
          term: "xterm-256color",
          cols,
          rows,
        },
        (err, stream: ClientChannel) => {
          if (err) {
            return reject(new Error(`PTY 伪终端会话创建失败: ${err.message}`));
          }

          const session: ActivePTYSession = {
            sessionId,
            connectionId: conn.id,
            stream,
            buffer: [],
            createdAt: new Date(),
          };

          stream.on("data", (chunk: Buffer) => {
            session.buffer.push(chunk.toString("utf-8"));
          });

          stream.on("close", () => {
            this.sessions.delete(sessionId);
          });

          stream.on("error", (error: Error) => {
            process.stderr.write(`[mcp-server-ssh] PTY 终端会话 ${sessionId} 异常: ${error.message}\n`);
            this.sessions.delete(sessionId);
          });

          this.sessions.set(sessionId, session);
          resolve({ sessionId });
        }
      );
    });
  }

  /**
   * 向指定 PTY 终端写入指令或控制字符并收集输出
   *
   * @param params 发送指令入参
   * @return 增量收集到的终端输出
   */
  public async sendInput(params: SSHSessionSendParams): Promise<{ sessionId: string; output: string }> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error(`未找到活跃的 PTY 终端会话 (${params.sessionId})，可能已被关闭或超时退出`);
    }

    // 1. 若输入带有换行且构成完整命令，前置通过安全守卫拦截致命破坏性命令
    if (params.input.includes("\n") || params.input.includes("\r")) {
      this.safetyGuard.assertSafe(params.input);
    }

    // 2. 清理历史旧缓存，准备收集本次增量响应
    session.buffer = [];

    // 3. 写入输入内容（支持发送控制字符如 '\x03' Ctrl+C）
    session.stream.write(params.input);

    // 4. 等待收集响应
    const waitTime = params.waitForMs || 1000;
    await new Promise((resolve) => setTimeout(resolve, waitTime));

    // 5. 读取并净化输出
    const rawOutput = session.buffer.join("");
    const processed = this.outputTruncator.process(rawOutput);

    return {
      sessionId: params.sessionId,
      output: processed.text,
    };
  }

  /**
   * 关闭指定的 PTY 终端会话并回收资源
   *
   * @param params 关闭会话参数
   * @return 关闭操作状态
   */
  public async closeSession(params: SSHSessionCloseParams): Promise<{ sessionId: string; closed: boolean }> {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      return { sessionId: params.sessionId, closed: false };
    }

    try {
      session.stream.end();
    } catch {}

    this.sessions.delete(params.sessionId);
    return { sessionId: params.sessionId, closed: true };
  }

  /**
   * 判断指定 sessionId 是否处于活跃状态
   */
  public hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * 关闭所有活跃会话
   */
  public async closeAll(): Promise<void> {
    for (const [id] of this.sessions.entries()) {
      await this.closeSession({ sessionId: id });
    }
  }
}
