/**
 * SessionService PTY 终端会话服务单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPool } from "../connection/manager.js";
import { SessionService } from "./session-service.js";

/**
 * 模拟的 PTY Shell 流通道
 */
class MockShellStream extends EventEmitter {
  public writtenData: string[] = [];
  public write = vi.fn((data: string) => {
    this.writtenData.push(data);
    // 模拟终端回显
    setTimeout(() => {
      this.emit("data", Buffer.from(`echo: ${data}`));
    }, 10);
    return true;
  });
  public end = vi.fn(() => {
    this.emit("close");
  });
}

class MockShellClient extends EventEmitter {
  public connect = vi.fn(() => {
    setTimeout(() => this.emit("ready"), 5);
    return this;
  });
  public end = vi.fn(() => {
    this.emit("close");
  });
  public shell = vi.fn((_opts, cb) => {
    const stream = new MockShellStream();
    cb(null, stream);
    return stream;
  });
}

describe("SessionService 交互式 PTY 伪终端会话服务", () => {
  it("应当能够成功创建并开启持久 PTY 终端会话", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockShellClient() as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SessionService({ connectionPool: pool });
    const { sessionId } = await service.startSession({ cols: 120, rows: 30 });

    expect(sessionId).toMatch(/^pty_/);
    expect(service.hasSession(sessionId)).toBe(true);
  });

  it("应当支持向持久终端发送输入指令并收集增量终端回显输出", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockShellClient() as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SessionService({ connectionPool: pool });
    const { sessionId } = await service.startSession({});

    const result = await service.sendInput({
      sessionId,
      input: "whoami\n",
      waitForMs: 50,
    });

    expect(result.sessionId).toBe(sessionId);
    expect(result.output).toContain("whoami");
  });

  it("应当拦截通过终端发送的致命命令", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockShellClient() as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SessionService({ connectionPool: pool });
    const { sessionId } = await service.startSession({});

    await expect(
      service.sendInput({
        sessionId,
        input: "rm -rf /\n",
      })
    ).rejects.toThrow("安全守卫阻断");
  });

  it("应当能够优雅关闭终端会话并回收资源", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockShellClient() as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SessionService({ connectionPool: pool });
    const { sessionId } = await service.startSession({});
    expect(service.hasSession(sessionId)).toBe(true);

    const closeResult = await service.closeSession({ sessionId });
    expect(closeResult.closed).toBe(true);
    expect(service.hasSession(sessionId)).toBe(false);
  });
});
