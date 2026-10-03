/**
 * MCP Server 装配入口与 Stdio/端到端工具连通性测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMCPServer } from "./index.js";

describe("MCP Server 装配入口与 ssh_ping 连通性测试", () => {
  let client: Client;
  let clientTransport: InstanceType<typeof InMemoryTransport>;
  let serverTransport: InstanceType<typeof InMemoryTransport>;

  beforeEach(async () => {
    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMCPServer();
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
  });

  it("应当成功列出所有已注册的基础工具列表，包含 ssh_ping", async () => {
    const result = await client.listTools();
    const pingTool = result.tools.find((t) => t.name === "ssh_ping");
    expect(pingTool).toBeDefined();
    expect(pingTool?.description).toContain("存活状态");
  });

  it("应当成功调用 ssh_ping 工具并返回规范的服务状态与默认 pong 响应", async () => {
    const response = await client.callTool({
      name: "ssh_ping",
      arguments: {},
    });

    expect(response.isError).toBeFalsy();
    expect(response.content).toHaveLength(1);
    const content = response.content[0];
    expect(content.type).toBe("text");
    if (content.type === "text") {
      const payload = JSON.parse(content.text);
      expect(payload.status).toBe("ok");
      expect(payload.service).toBe("mcp-server-ssh");
      expect(payload.version).toBe("0.1.0");
      expect(payload.echo).toBe("pong");
      expect(payload.timestamp).toBeDefined();
    }
  });

  it("应当在传入自定义 message 时正确回显该内容", async () => {
    const response = await client.callTool({
      name: "ssh_ping",
      arguments: {
        message: "hello-linux-mcp",
      },
    });

    expect(response.isError).toBeFalsy();
    const content = response.content[0];
    if (content.type === "text") {
      const payload = JSON.parse(content.text);
      expect(payload.echo).toBe("hello-linux-mcp");
    }
  });
});
