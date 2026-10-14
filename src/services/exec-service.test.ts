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
  public writtenData: string[] = [];
  public write = vi.fn((data: string) => {
    this.writtenData.push(data);
    return true;
  });
  public close = vi.fn();
  public signal = vi.fn();
}

class MockExecClient extends EventEmitter {
  public lastExecutedCommand = "";
  public lastStream?: MockChannelStream;
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
    this.lastStream = stream;
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

  it("当传入 dangerouslySkipSafetyCheck 但无 allowDangerousCommands 授权时，应当拒绝执行危险命令", async () => {
    const pool = new ConnectionPool();
    const service = new ExecService({ connectionPool: pool, allowDangerousCommands: false });

    await expect(
      service.execute({
        command: "reboot",
        dangerouslySkipSafetyCheck: true,
      })
    ).rejects.toThrow("拒绝执行危险命令");
  });

  it("当配置了 allowDangerousCommands 与 dangerouslySkipSafetyCheck 时，应当放行危险命令", async () => {
    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new ExecService({ connectionPool: pool, allowDangerousCommands: true });
    const result = await service.execute({
      command: "reboot",
      dangerouslySkipSafetyCheck: true,
      rawExec: true,
    });

    expect(result.exitCode).toBe(0);
    expect(mockClient.lastExecutedCommand).toBe("reboot");
  });

  it("当未找到可用连接且存在上次建连失败记录时，错误信息应附带诊断原因", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => {
        const client = new MockExecClient();
        client.connect = vi.fn(() => {
          setTimeout(() => client.emit("error", new Error("网络不可达 192.168.1.99:22")), 5);
          return client;
        });
        return client as any;
      },
    });

    try {
      await pool.connect({ host: "192.168.1.99" });
    } catch {}

    const service = new ExecService({ connectionPool: pool });
    await expect(
      service.execute({ command: "uptime" })
    ).rejects.toThrow("最近一次尝试建连失败原因: 网络不可达 192.168.1.99:22");
  });

  it("当指定 sudo: true 时应当通过 sudo -S 包装执行并通过 stdin 流安全注入提权密码", async () => {
    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "ubuntu", password: "default-password" });

    const service = new ExecService({ connectionPool: pool });
    const result = await service.execute({
      command: "systemctl restart nginx",
      sudo: true,
      sudoPassword: "custom-sudo-password",
      rawExec: true,
    });

    expect(result.exitCode).toBe(0);
    // 验证命令行上绝不出现密码
    expect(mockClient.lastExecutedCommand).toBe("sudo -S -p '' systemctl restart nginx");
    expect(mockClient.lastExecutedCommand).not.toContain("custom-sudo-password");
    // 验证密码通过 channel stdin 流写入
    expect(mockClient.lastStream?.writtenData).toEqual(["custom-sudo-password\n"]);
  });

  it("当注入了 AuditService 时，发生安全拦截与 Sudo 提权应记录内部 security 审计事件", async () => {
    const auditEvents: any[] = [];
    const mockAuditService = {
      isEnabled: () => true,
      log: vi.fn(async (event: any) => {
        auditEvents.push(event);
      }),
    } as any;

    const mockClient = new MockExecClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "ubuntu", password: "pwd" });

    const service = new ExecService({
      connectionPool: pool,
      auditService: mockAuditService,
    });

    // 1. 高危命令拦截测试
    await expect(service.execute({ command: "rm -rf /" })).rejects.toThrow();
    expect(auditEvents.some((e) => e.action === "safety_guard_blocked" && e.level === "security")).toBe(true);

    // 2. Sudo 提权内部审计测试
    await service.execute({ command: "apt-get update", sudo: true });
    expect(auditEvents.some((e) => e.action === "escalate_sudo" && e.level === "security")).toBe(true);
  });
});

