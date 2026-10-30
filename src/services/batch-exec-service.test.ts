/**
 * 批量命令执行服务 (BatchExecService) 与 ssh_batch_exec 工具协议层集成测试
 *
 * 通过 MCP InMemoryTransport 顶层协议接缝验证并发限流、串行中断、按需建连、熔断隔离、16KB 紧凑截断与安全守卫
 *
 * @author Ateng
 * @since 2026-10-30
 */

import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSHConfigParser } from "../connection/config-parser.js";
import { ConnectionPool } from "../connection/pool.js";
import { createMCPServer } from "../index.js";

class MockExecChannel extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public close = vi.fn();
  public write = vi.fn();
  public signal = vi.fn();
}

describe("ssh_batch_exec 批量命令执行与并发/串行调度引擎 (MCP In-Memory Seam)", () => {
  const sampleSshConfig = `
Host web-1
  HostName 10.0.1.1
  User ubuntu

Host web-2
  HostName 10.0.1.2
  User ubuntu

Host web-3
  HostName 10.0.1.3
  User ubuntu

Host web-4
  HostName 10.0.1.4
  User ubuntu

Host dead-node
  HostName 10.0.9.99
  User ubuntu
`;

  let configParser: SSHConfigParser;
  let pool: ConnectionPool;
  let mcpClient: Client;
  let clientTransport: InstanceType<typeof InMemoryTransport>;
  let serverTransport: InstanceType<typeof InMemoryTransport>;

  let activeConcurrency = 0;
  let maxObservedConcurrency = 0;
  let hostBehavior: Record<
    string,
    {
      connectError?: string;
      exitCode?: number;
      stdout?: string;
      stderr?: string;
      delayMs?: number;
    }
  > = {};

  beforeEach(async () => {
    activeConcurrency = 0;
    maxObservedConcurrency = 0;
    hostBehavior = {};

    configParser = new SSHConfigParser(sampleSshConfig);
    pool = new ConnectionPool({
      configParser,
      clientFactory: () => {
        const client = new EventEmitter() as any;
        let currentHost = "";
        client.end = vi.fn(() => client.emit("close"));
        client.destroy = vi.fn();
        client.connect = vi.fn((cfg: any) => {
          currentHost = cfg.host;
          const behavior = hostBehavior[currentHost] ?? {};
          queueMicrotask(() => {
            if (behavior.connectError) {
              client.emit("error", new Error(behavior.connectError));
            } else {
              client.emit("ready");
            }
          });
        });
        client.exec = vi.fn((_cmd: string, _opts: any, cb: any) => {
          const stream = new MockExecChannel();
          const behavior = hostBehavior[currentHost] ?? {};
          activeConcurrency++;
          if (activeConcurrency > maxObservedConcurrency) {
            maxObservedConcurrency = activeConcurrency;
          }

          const delay = behavior.delayMs ?? 5;
          setTimeout(() => {
            activeConcurrency--;
            if (behavior.stdout) {
              stream.stdout.emit("data", Buffer.from(behavior.stdout, "utf-8"));
            } else {
              stream.stdout.emit("data", Buffer.from(`ack from ${currentHost}\n`, "utf-8"));
            }
            if (behavior.stderr) {
              stream.stderr.emit("data", Buffer.from(behavior.stderr, "utf-8"));
            }
            stream.emit("exit", behavior.exitCode ?? 0);
            stream.emit("close");
          }, delay);

          cb(null, stream);
          return stream;
        });
        return client;
      },
    });

    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMCPServer({ connectionPool: pool, configParser });
    await server.connect(serverTransport);

    mcpClient = new Client(
      { name: "batch-test-client", version: "1.0.0" },
      { capabilities: {} }
    );
    await mcpClient.connect(clientTransport);
  });

  afterEach(async () => {
    await mcpClient.close();
    await clientTransport.close();
    await serverTransport.close();
    await pool.closeAll();
  });

  it("应当注册 ssh_batch_exec 工具并在 parallel 模式下严格受 concurrency 并发上限约束", async () => {
    const tools = await mcpClient.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("ssh_batch_exec");

    for (const ip of ["10.0.1.1", "10.0.1.2", "10.0.1.3", "10.0.1.4"]) {
      hostBehavior[ip] = { delayMs: 25 };
    }

    const res = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-*"],
        command: "uptime",
        mode: "parallel",
        concurrency: 2,
      },
    });

    expect(res.isError).toBeFalsy();
    const payload = JSON.parse((res.content[0] as any).text);
    expect(payload.totalTargets).toBe(4);
    expect(payload.succeeded).toBe(4);
    expect(payload.failed).toBe(0);
    expect(payload.skipped).toBe(0);
    // 关键断言：最大并发执行数不得超过设定的 concurrency: 2
    expect(maxObservedConcurrency).toBeLessThanOrEqual(2);
    expect(maxObservedConcurrency).toBeGreaterThanOrEqual(2);
    expect(payload.results["web-1"].stdout).toContain("ack from 10.0.1.1");
    expect(payload.results["web-4"].stdout).toContain("ack from 10.0.1.4");
  });

  it("在 serial 模式且 stopOnError: true 时，遇到非 0 退出码应立即终止后续节点并标记为 skipped", async () => {
    hostBehavior["10.0.1.1"] = { exitCode: 0, stdout: "step 1 ok\n" };
    hostBehavior["10.0.1.2"] = { exitCode: 2, stderr: "migration failed\n" };
    hostBehavior["10.0.1.3"] = { exitCode: 0, stdout: "should not run\n" };

    const res = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-1", "web-2", "web-3"],
        command: "./deploy.sh",
        mode: "serial",
        stopOnError: true,
      },
    });

    const payload = JSON.parse((res.content[0] as any).text);
    expect(payload.totalTargets).toBe(3);
    expect(payload.succeeded).toBe(1);
    expect(payload.failed).toBe(1);
    expect(payload.skipped).toBe(1);

    expect(payload.results["web-1"].status).toBe("success");
    expect(payload.results["web-2"].status).toBe("failed");
    expect(payload.results["web-2"].exitCode).toBe(2);
    expect(payload.results["web-3"].status).toBe("skipped");
    expect(payload.results["web-3"].exitCode).toBeNull();
  });

  it("遇到未预连的目标时自动触发按需建连；单节点建连失败或处于熔断冷却期不影响其他健康节点", async () => {
    hostBehavior["10.0.9.99"] = { connectError: "connect ECONNREFUSED 10.0.9.99:22" };

    // 第一次批量调用：dead-node 建连失败触发熔断，web-1 与 web-2 正常成功
    const res1 = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-1", "dead-node", "web-2"],
        command: "hostname",
      },
    });

    const payload1 = JSON.parse((res1.content[0] as any).text);
    expect(payload1.succeeded).toBe(2);
    expect(payload1.failed).toBe(1);
    expect(payload1.results["web-1"].status).toBe("success");
    expect(payload1.results["web-2"].status).toBe("success");
    expect(payload1.results["dead-node"].status).toBe("failed");
    expect(payload1.results["dead-node"].error).toContain("ECONNREFUSED");

    // 第二次批量调用：dead-node 处于熔断冷却期，应立即返回熔断冷却错误且不影响 web-1
    const res2 = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["dead-node", "web-1"],
        command: "hostname",
      },
    });

    const payload2 = JSON.parse((res2.content[0] as any).text);
    expect(payload2.succeeded).toBe(1);
    expect(payload2.failed).toBe(1);
    expect(payload2.results["dead-node"].status).toBe("failed");
    expect(payload2.results["dead-node"].error).toContain("熔断冷却期");
    expect(payload2.results["web-1"].status).toBe("success");
  });

  it("单机输出超出 16KB 时应执行紧凑截断（4KB 头部 + 12KB 尾部）并标记 isTruncated: true", async () => {
    const headMarker = "HEAD_MARKER_START_";
    const tailMarker = "_TAIL_MARKER_END";
    const largeOutput =
      headMarker + "A".repeat(20 * 1024) + tailMarker;
    hostBehavior["10.0.1.1"] = { stdout: largeOutput };

    const res = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-1"],
        command: "cat /var/log/syslog",
      },
    });

    const payload = JSON.parse((res.content[0] as any).text);
    const nodeRes = payload.results["web-1"];
    expect(nodeRes.status).toBe("success");
    expect(nodeRes.isTruncated).toBe(true);
    expect(nodeRes.stdout).toContain(headMarker);
    expect(nodeRes.stdout).toContain(tailMarker);
    expect(nodeRes.stdout).toContain("16KB");
  });

  it("应当统一经过 SafetyGuard 校验阻断高危命令，并支持 dryRun 预检模式", async () => {
    // 1. 高危命令拦截
    const blockedRes = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-1", "web-2"],
        command: "rm -rf /",
      },
    });
    expect(blockedRes.isError).toBe(true);
    expect((blockedRes.content[0] as any).text).toContain("安全守卫阻断");

    // 2. dryRun 预检模式（不触发实际远程建连或执行）
    const dryRunRes = await mcpClient.callTool({
      name: "ssh_batch_exec",
      arguments: {
        targets: ["web-1", "web-2"],
        command: "df -h",
        dryRun: true,
      },
    });
    expect(dryRunRes.isError).toBeFalsy();
    const dryPayload = JSON.parse((dryRunRes.content[0] as any).text);
    expect(dryPayload.dryRun).toBe(true);
    expect(dryPayload.succeeded).toBe(2);
    expect(dryPayload.results["web-1"].stdout).toContain("[dryRun]");
    expect(pool.listConnections()).toHaveLength(0);
  });
});
