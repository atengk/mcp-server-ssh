/**
 * MCP Server 装配入口与 Stdio/端到端工具连通性测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectionPool } from "./connection/manager.js";
import { SSHConfigParser } from "./connection/config-parser.js";
import { createMCPServer } from "./index.js";

class MockSSHClient extends EventEmitter {
  public end = vi.fn(() => {
    this.emit("close");
  });
  public connect = vi.fn(() => {
    setTimeout(() => this.emit("ready"), 5);
    return this;
  });
}

describe("MCP Server 装配入口与工具调用端到端测试", () => {
  let client: Client;
  let clientTransport: InstanceType<typeof InMemoryTransport>;
  let serverTransport: InstanceType<typeof InMemoryTransport>;
  let pool: ConnectionPool;
  let configParser: SSHConfigParser;

  beforeEach(async () => {
    configParser = new SSHConfigParser(`
Host test-alias
  HostName 192.168.10.50
  User tester
  Port 22
`);
    pool = new ConnectionPool({
      clientFactory: () => new MockSSHClient() as any,
      configParser,
    });

    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMCPServer({ connectionPool: pool, configParser });
    await server.connect(serverTransport);

    client = new Client(
      {
        name: "test-mcp-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await clientTransport.close();
    await serverTransport.close();
    await pool.closeAll();
  });

  it("应当暴露完整的连接管理工具矩阵与基础 ping 工具", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("ssh_ping");
    expect(toolNames).toContain("ssh_connect");
    expect(toolNames).toContain("ssh_disconnect");
    expect(toolNames).toContain("ssh_list_connections");
    expect(toolNames).toContain("ssh_list_config_hosts");
  });

  it("通过 ssh_connect 建立连接后，能够通过 ssh_list_connections 查询到活跃连接", async () => {
    const connectRes = await client.callTool({
      name: "ssh_connect",
      arguments: {
        host: "10.0.0.1",
        username: "root",
        connectionId: "test-conn",
      },
    });

    expect(connectRes.isError).toBeFalsy();
    const connectData = JSON.parse((connectRes.content[0] as any).text);
    expect(connectData.status).toBe("connected");
    expect(connectData.connection.connectionId).toBe("test-conn");

    const listRes = await client.callTool({
      name: "ssh_list_connections",
      arguments: {},
    });
    const listData = JSON.parse((listRes.content[0] as any).text);
    expect(listData.connections).toHaveLength(1);
    expect(listData.connections[0].connectionId).toBe("test-conn");
    expect(listData.connections[0].isDefault).toBe(true);
  });

  it("通过 ssh_list_config_hosts 应当能够列出 ~/.ssh/config 中解析到的预设主机", async () => {
    const res = await client.callTool({
      name: "ssh_list_config_hosts",
      arguments: {},
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.hosts).toHaveLength(1);
    expect(data.hosts[0].alias).toBe("test-alias");
    expect(data.hosts[0].hostName).toBe("192.168.10.50");
  });

  it("通过 ssh_disconnect 可以成功断开并移除连接", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: {
        host: "10.0.0.1",
        username: "root",
        connectionId: "to-remove",
      },
    });

    const disconnectRes = await client.callTool({
      name: "ssh_disconnect",
      arguments: {
        connectionId: "to-remove",
      },
    });

    const discData = JSON.parse((disconnectRes.content[0] as any).text);
    expect(discData.status).toBe("disconnected");

    const listRes = await client.callTool({
      name: "ssh_list_connections",
      arguments: {},
    });
    const listData = JSON.parse((listRes.content[0] as any).text);
    expect(listData.connections).toHaveLength(0);
  });
});
