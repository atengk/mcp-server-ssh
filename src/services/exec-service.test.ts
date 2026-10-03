/**
 * ExecService 命令执行服务单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPool } from "../connection/manager.js";
import { ExecService } from "./exec-service.js";

/**
 * 模拟的 SSH Client 与 Exec 流通道
 */
class MockChannelStream extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public close = vi.fn();
  public signal = vi.fn();
}

class MockExecClient extends EventEmitter {
  public lastExecutedCommand = "";
  public connect = vi.fn(() => {
    setTimeout(() => this.emit("ready"), 5);
    return this;
  });
  public end = vi.fn(() => {
    this.emit("close");
  });
  public exec = vi.fn((cmd, _opts, cb) => {
    this.lastExecutedCommand = cmd;
    const stream = new MockChannelStream();
    setTimeout(() => {
      stream.stdout.emit("data", Buffer.from("Linux kernel 6.8\n"));
      stream.stderr.emit("data", Buffer.from(""));
      stream.emit("exit", 0);
      stream.emit("close");
    }, 10);
    cb(null, stream);
    return stream;
  });
}

describe("ExecService 远程命令执行服务", () => {
  it("应当拦截高危致命删除命令并直接拒绝执行", async () => {
    const pool = new ConnectionPool();
    const service = new ExecService({ connectionPool: pool });

    await expect(
      service.execute({
        command: "rm -rf /",
      })
    ).rejects.toThrow("安全守卫阻断");
  });

  it("在 dryRun: true 模式下应当放行合规命令并返回测试标记而不实际下发", async () => {
    const pool = new ConnectionPool();
    const service = new ExecService({ connectionPool: pool });

    const result = await service.execute({
      command: "echo 'hello world'",
      dryRun: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[dryRun]");
  });

  it("应当默认使用登录 Shell 包装命令并精准返回退出码与标准输出", async () => {
    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new ExecService({ connectionPool: pool });
    const result = await service.execute({
      command: "uname -r",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("Linux kernel 6.8\n");
    expect(mockClient.lastExecutedCommand).toBe("bash -l -c 'uname -r'");
  });

  it("当指定 rawExec: true 时，应当绕过 bash -l -c 原生下发", async () => {
    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new ExecService({ connectionPool: pool });
    await service.execute({
      command: "uname -r",
      rawExec: true,
    });

    expect(mockClient.lastExecutedCommand).toBe("uname -r");
  });

  it("当指定 cwd 时，应当自动追加 cd 目录前缀", async () => {
    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new ExecService({ connectionPool: pool });
    await service.execute({
      command: "ls -la",
      cwd: "/var/log",
      rawExec: true,
    });

    expect(mockClient.lastExecutedCommand).toBe("cd '/var/log' && ls -la");
  });
});
