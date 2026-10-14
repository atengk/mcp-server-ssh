/**
 * 安全审计中枢服务单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuditService } from "./service.js";
import { FileAuditSink, StderrAuditSink } from "./sink.js";
import type { AuditEvent, AuditSink } from "./types.js";

describe("安全审计调度引擎 (AuditService) - ADR-0014", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-service-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("当审计未启用时 (enabled: false)，记录操作应静默跳过且不调用 Sink", async () => {
    const mockSink: AuditSink = {
      write: vi.fn(),
      close: vi.fn(),
    };

    const service = new AuditService(
      {
        enabled: false,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
      mockSink
    );

    await service.log({
      level: "info",
      category: "exec",
      action: "ssh_exec",
      result: { status: "success", durationMs: 12 },
      source: "service_internal",
    });

    expect(mockSink.write).not.toHaveBeenCalled();
  });

  it("当审计启用时，应自动补充 UUID 与 ISO 时间戳并执行参数脱敏清洗", async () => {
    let capturedEvent: AuditEvent | null = null;
    const mockSink: AuditSink = {
      write: vi.fn((event: AuditEvent) => {
        capturedEvent = event;
      }),
      close: vi.fn(),
    };

    const service = new AuditService(
      {
        enabled: true,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
      mockSink
    );

    await service.log({
      level: "info",
      category: "exec",
      action: "ssh_exec",
      connectionId: "conn-1",
      target: { host: "10.0.0.1", port: 22, user: "admin" },
      params: {
        command: "ls -la",
        password: "raw_password",
      },
      result: { status: "success", durationMs: 45 },
      source: "service_internal",
    });

    expect(mockSink.write).toHaveBeenCalledTimes(1);
    expect(capturedEvent).not.toBeNull();
    expect(capturedEvent!.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(capturedEvent!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(capturedEvent!.params?.password).toBe("[REDACTED]");
    expect(capturedEvent!.params?.command).toBe("ls -la");
  });

  it("recordToolCall 能自动捕获函数执行耗时并根据成功/异常打标", async () => {
    const capturedEvents: AuditEvent[] = [];
    const mockSink: AuditSink = {
      write: vi.fn((event: AuditEvent) => {
        capturedEvents.push(event);
      }),
      close: vi.fn(),
    };

    const service = new AuditService(
      {
        enabled: true,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
      mockSink
    );

    // 1. 成功调用测试
    const successResult = await service.recordToolCall(
      "ssh_exec",
      { command: "whoami", password: "secret" },
      async () => "root\n"
    );
    expect(successResult).toBe("root\n");
    expect(capturedEvents.length).toBe(1);
    expect(capturedEvents[0].level).toBe("info");
    expect(capturedEvents[0].result.status).toBe("success");
    expect(capturedEvents[0].result.durationMs).toBeGreaterThanOrEqual(0);

    // 2. 异常失败调用测试
    await expect(
      service.recordToolCall("ssh_exec", { command: "bad" }, async () => {
        throw new Error("Command failed");
      })
    ).rejects.toThrow("Command failed");

    expect(capturedEvents.length).toBe(2);
    expect(capturedEvents[1].level).toBe("error");
    expect(capturedEvents[1].result.status).toBe("failure");
    expect(capturedEvents[1].result.error).toContain("Command failed");
  });

  it("柔性降级 (strict: false)：Sink 写入异常时不中断业务并向 stderr 报警", async () => {
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const faultySink: AuditSink = {
      write: vi.fn(() => {
        throw new Error("Disk full or permission denied");
      }),
      close: vi.fn(),
    };

    const service = new AuditService(
      {
        enabled: true,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
      faultySink
    );

    await expect(
      service.log({
        level: "info",
        category: "exec",
        action: "test",
        result: { status: "success", durationMs: 5 },
        source: "mcp_tool",
      })
    ).resolves.not.toThrow();

    expect(stderrSpy).toHaveBeenCalled();
    stderrSpy.mockRestore();
  });

  it("严格熔断 (strict: true)：Sink 写入异常时应立即抛错阻断业务", async () => {
    const faultySink: AuditSink = {
      write: vi.fn(() => {
        throw new Error("Fatal I/O Error");
      }),
      close: vi.fn(),
    };

    const service = new AuditService(
      {
        enabled: true,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: true,
      },
      faultySink
    );

    await expect(
      service.log({
        level: "info",
        category: "exec",
        action: "test",
        result: { status: "success", durationMs: 5 },
        source: "mcp_tool",
      })
    ).rejects.toThrow(/Fatal I\/O Error/);
  });

  it("集成真实 FileAuditSink 能够写入单行 NDJSON 文件", async () => {
    const logPath = path.join(tempDir, "audit.log");
    const fileSink = new FileAuditSink({
      filePath: logPath,
      maxSizeMb: 1,
      maxFiles: 2,
    });

    const service = new AuditService(
      {
        enabled: true,
        logPath,
        maxSizeMb: 1,
        maxFiles: 2,
        strict: true,
      },
      fileSink
    );

    await service.log({
      level: "security",
      category: "safety",
      action: "safety_guard_blocked",
      params: { command: "rm -rf /" },
      result: { status: "blocked", durationMs: 1 },
      source: "service_internal",
    });

    await service.close();

    expect(fs.existsSync(logPath)).toBe(true);
    const content = fs.readFileSync(logPath, "utf-8").trim();
    const parsed = JSON.parse(content);
    expect(parsed.level).toBe("security");
    expect(parsed.action).toBe("safety_guard_blocked");
    expect(parsed.params.command).toBe("rm -rf /");
  });
});
