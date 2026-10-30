/**
 * 目标解析器 (TargetResolver) 与多主机启动异步预建连单元测试
 *
 * @author Ateng
 * @since 2026-10-30
 */

import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it, vi } from "vitest";
import { parseEnv } from "../config/env.js";
import { createMCPServer, preconnectConfiguredHosts } from "../index.js";
import { HostInCooldownError } from "./circuit-breaker.js";
import { SSHConfigParser } from "./config-parser.js";
import { ConnectionPool } from "./pool.js";
import { TargetResolver } from "./target-resolver.js";

function createReadyMockClient() {
  const client = new EventEmitter() as any;
  client.end = vi.fn(() => client.emit("close"));
  client.destroy = vi.fn();
  client.connect = vi.fn(() => {
    queueMicrotask(() => client.emit("ready"));
  });
  return client;
}

describe("TargetResolver 目标选择器解析引擎", () => {
  const sampleSshConfig = `
Host web-prod-1
  HostName 10.0.1.11
  User ubuntu

Host web-prod-2
  HostName 10.0.1.12
  User ubuntu

Host db-master
  HostName 10.0.2.10
  User postgres

Host cache-redis
  HostName 10.0.3.10
  User default
`;

  it("应当正确展开 @all_active 为当前连接池中所有活跃连接 ID", async () => {
    const configParser = new SSHConfigParser(sampleSshConfig);
    const pool = new ConnectionPool({
      configParser,
      clientFactory: () => createReadyMockClient(),
    });

    await pool.connect({ sshConfigAlias: "web-prod-1", connectionId: "web-prod-1" });
    await pool.connect({ host: "10.0.9.9", username: "root", connectionId: "adhoc-node" });

    const resolver = new TargetResolver({ connectionPool: pool, configParser });
    expect(resolver.resolve(["@all_active"])).toEqual(["web-prod-1", "adhoc-node"]);
  });

  it("应当正确展开 @all_configured 为 ~/.ssh/config 中所有明确配置的主机别名", () => {
    const configParser = new SSHConfigParser(sampleSshConfig);
    const pool = new ConnectionPool({ configParser });
    const resolver = new TargetResolver({ connectionPool: pool, configParser });

    expect(resolver.resolve(["@all_configured"])).toEqual([
      "web-prod-1",
      "web-prod-2",
      "db-master",
      "cache-redis",
    ]);
  });

  it("应当支持前缀通配符（如 web-*）及组合选择器，并按首次出现顺序自动去重", async () => {
    const configParser = new SSHConfigParser(sampleSshConfig);
    const pool = new ConnectionPool({
      configParser,
      clientFactory: () => createReadyMockClient(),
    });

    await pool.connect({ sshConfigAlias: "db-master", connectionId: "db-master" });

    const resolver = new TargetResolver({ connectionPool: pool, configParser });
    const targets = resolver.resolve([
      "web-*",
      "@all_active",
      "web-prod-1",
      "cache-*",
      "custom-node",
    ]);

    expect(targets).toEqual([
      "web-prod-1",
      "web-prod-2",
      "db-master",
      "cache-redis",
      "custom-node",
    ]);
  });

  it("应当支持解析 MCP_SSH_PRECONNECT_TARGETS 并在启动时并发软容错预连，且在 ssh_list_targets 中展示成功与失败状态", async () => {
    const config = parseEnv({
      MCP_SSH_PRECONNECT_TARGETS: " web-prod-1 , db-master , cache-redis ",
      MCP_SSH_CONNECT_TIMEOUT_MS: "5000",
    });

    expect(config.preconnectTargets).toEqual(["web-prod-1", "db-master", "cache-redis"]);
    expect(config.connectTimeoutMs).toBe(5000);

    const configParser = new SSHConfigParser(sampleSshConfig);
    const pool = new ConnectionPool({
      configParser,
      connectTimeoutMs: config.connectTimeoutMs,
      clientFactory: () => {
        const client = new EventEmitter() as any;
        client.end = vi.fn(() => client.emit("close"));
        client.destroy = vi.fn();
        client.connect = vi.fn((connectCfg: any) => {
          queueMicrotask(() => {
            // 模拟 db-master (10.0.2.10) 失联拒绝，其余节点正常就绪
            if (connectCfg.host === "10.0.2.10") {
              client.emit("error", new Error("connect ECONNREFUSED 10.0.2.10:22"));
            } else {
              client.emit("ready");
            }
          });
        });
        return client;
      },
    });

    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    try {
      // 1. 执行启动并发预连（Fail-Soft：db-master 失败不应抛出未捕获异常阻断启动）
      await expect(preconnectConfiguredHosts(pool, config)).resolves.toBeUndefined();

      // 验证 warning 已写入 stderr
      const stderrOutput = stderrSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(stderrOutput).toContain("db-master");

      // 2. 验证成功节点已加入活跃连接池，失败节点已进入熔断冷却期
      expect(pool.listConnections().map((c) => c.connectionId)).toEqual([
        "web-prod-1",
        "cache-redis",
      ]);
      await expect(
        pool.connect({ sshConfigAlias: "db-master", connectionId: "db-master" })
      ).rejects.toThrow(HostInCooldownError);

      // 3. 通过 MCP 协议调用 ssh_list_targets，直观查看预连成功与失败的主机状态
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const server = createMCPServer({ connectionPool: pool, configParser });
      await server.connect(serverTransport);

      const mcpClient = new Client(
        { name: "test-client", version: "1.0.0" },
        { capabilities: {} }
      );
      await mcpClient.connect(clientTransport);

      const res = await mcpClient.callTool({
        name: "ssh_list_targets",
        arguments: {},
      });

      expect(res.isError).toBeFalsy();
      const payload = JSON.parse((res.content[0] as any).text);
      expect(payload.totalActive).toBe(2);
      expect(payload.totalConfigured).toBe(4);
      expect(payload.totalFailed).toBe(1);
      expect(payload.failedTargets).toHaveLength(1);
      expect(payload.failedTargets[0].targetId).toBe("db-master");
      expect(payload.failedTargets[0].state).toBe("open");

      const hostStatusMap = Object.fromEntries(
        payload.configuredHosts.map((h: any) => [h.alias, h.status])
      );
      expect(hostStatusMap).toEqual({
        "web-prod-1": "connected",
        "web-prod-2": "disconnected",
        "db-master": "cooldown",
        "cache-redis": "connected",
      });

      await mcpClient.close();
      await clientTransport.close();
      await serverTransport.close();
    } finally {
      stderrSpy.mockRestore();
      await pool.closeAll();
    }
  });
});
