/**
 * HTTP SSE 传输服务单元与集成测试
 *
 * @author Ateng
 * @since 2026-10-04
 */

import http from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { startSSEServer, verifyAuthToken, type RunningSSEServer } from "./sse-server.js";

describe("HTTP SSE 传输服务 (SSEServer)", () => {
  let mcpServer: McpServer;
  let runningServer: RunningSSEServer;
  let baseUrl: string;

  beforeEach(async () => {
    // 使用工厂函数为每次连接创建独立 McpServer 实例以支持并发
    runningServer = await startSSEServer({
      serverFactory: () => {
        const s = new McpServer({
          name: "mcp-server-ssh-test",
          version: "1.0.0-test",
        });
        s.tool(
          "test_ping",
          "测试工具",
          { msg: z.string().optional() },
          async ({ msg }) => ({
            content: [{ type: "text", text: `echo: ${msg || "pong"}` }],
          })
        );
        return s;
      },
      host: "127.0.0.1",
      port: 0,
    });

    baseUrl = `http://127.0.0.1:${runningServer.port}`;
  });

  afterEach(async () => {
    if (runningServer) {
      await runningServer.close();
    }
  });

  it("健康检查端点 GET /health 与 GET /ping 应返回脱敏的 healthy 状态 (无内部版本或连接数)", async () => {
    const resHealth = await fetch(`${baseUrl}/health`);
    expect(resHealth.status).toBe(200);
    const dataHealth = await resHealth.json();
    expect(dataHealth).toEqual({ status: "healthy" });

    const resPing = await fetch(`${baseUrl}/ping`);
    expect(resPing.status).toBe(200);
    const dataPing = await resPing.json();
    expect(dataPing).toEqual({ status: "healthy" });
  });

  it("根路径 GET / 不再暴露健康检查，应返回 404 Not Found", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(404);
  });

  it("非回环绑定且未配置 authToken 时启动 startSSEServer 应抛出安全熔断异常", async () => {
    await expect(
      startSSEServer({
        host: "0.0.0.0",
        port: 0,
      })
    ).rejects.toThrowError(/安全熔断: 外部网络绑定 \(0\.0\.0\.0\) 必须配置 MCP_SSH_AUTH_TOKEN/);
  });

  describe("CORS 跨域策略与来源白名单 (Origin Whitelist)", () => {
    it("默认未配置 allowedOrigins 时不应返回允许跨域标头与通配符 *", async () => {
      const res = await fetch(`${baseUrl}/sse`, {
        method: "OPTIONS",
        headers: { Origin: "http://malicious.example.com" },
      });
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("配置 allowedOrigins 后，命中白名单的 Origin 应返回对应的 CORS 响应标头与凭证支持，非白名单 Origin 不返回", async () => {
      const corsServer = await startSSEServer({
        allowedOrigins: ["http://localhost:3000", "https://chat.mycorp.internal"],
        serverFactory: () =>
          new McpServer({
            name: "mcp-server-ssh-cors-test",
            version: "1.0.0-test",
          }),
        host: "127.0.0.1",
        port: 0,
      });
      const corsUrl = `http://127.0.0.1:${corsServer.port}`;

      try {
        // 1. 命中白名单的 OPTIONS 预检请求
        const preflight = await fetch(`${corsUrl}/sse`, {
          method: "OPTIONS",
          headers: { Origin: "http://localhost:3000" },
        });
        expect(preflight.status).toBe(204);
        expect(preflight.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
        expect(preflight.headers.get("access-control-allow-credentials")).toBe("true");

        // 2. 命中白名单的普通 GET 请求
        const getRes = await fetch(`${corsUrl}/health`, {
          headers: { Origin: "https://chat.mycorp.internal" },
        });
        expect(getRes.status).toBe(200);
        expect(getRes.headers.get("access-control-allow-origin")).toBe("https://chat.mycorp.internal");

        // 3. 未命中白名单的恶意 Origin 请求
        const evilRes = await fetch(`${corsUrl}/health`, {
          headers: { Origin: "http://evil.com" },
        });
        expect(evilRes.status).toBe(200);
        expect(evilRes.headers.get("access-control-allow-origin")).toBeNull();
      } finally {
        await corsServer.close();
      }
    });
  });

  it("访问未知路径应返回 404", async () => {
    const res = await fetch(`${baseUrl}/not-exist`);
    expect(res.status).toBe(404);
  });

  it("缺少 sessionId 或 sessionId 不存在时 POST /message 应返回 404", async () => {
    const resNoId = await fetch(`${baseUrl}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(resNoId.status).toBe(404);

    const resInvalidId = await fetch(`${baseUrl}/message?sessionId=non-existent-id`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(resInvalidId.status).toBe(404);
  });

  it("完整的 SSE 建立流与客户端通过 /message 交互流程", async () => {
    // 1. 发起 GET /sse 建立事件流
    const sseController = new AbortController();
    const sseResponse = await fetch(`${baseUrl}/sse`, {
      signal: sseController.signal,
      headers: { Accept: "text/event-stream" },
    });

    expect(sseResponse.status).toBe(200);
    expect(sseResponse.headers.get("content-type")).toContain("text/event-stream");

    // 2. 读取第一帧 endpoint 事件，提取 sessionId
    const reader = sseResponse.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let initialChunk = "";

    // 读取直到接收到 endpoint 数据
    while (!initialChunk.includes("endpoint")) {
      const { value, done } = await reader!.read();
      if (done) break;
      initialChunk += decoder.decode(value, { stream: true });
    }

    expect(initialChunk).toContain("event: endpoint");
    expect(initialChunk).toContain("/message?sessionId=");

    // 解析出 sessionId
    const match = initialChunk.match(/sessionId=([a-zA-Z0-9-_]+)/);
    expect(match).not.toBeNull();
    const sessionId = match![1];

    // 3. 客户端通过 POST /message?sessionId=xxx 发送初始化请求
    const initPayload = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };

    const postRes = await fetch(`${baseUrl}/message?sessionId=${sessionId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(initPayload),
    });

    expect(postRes.status).toBe(202);

    // 4. 从 SSE 流中读取 initialize 响应
    let sseOutput = "";
    while (!sseOutput.includes('"result"')) {
      const { value, done } = await reader!.read();
      if (done) break;
      sseOutput += decoder.decode(value, { stream: true });
    }

    expect(sseOutput).toContain('"protocolVersion"');
    expect(sseOutput).toContain('"serverInfo"');

    // 5. 中断断开 SSE 客户端流
    sseController.abort();
  });

  it("应支持多个客户端并发建立独立的 SSE 会话且互不干扰", async () => {
    // 客户端 A
    const ctrlA = new AbortController();
    const resA = await fetch(`${baseUrl}/sse`, { signal: ctrlA.signal, headers: { Accept: "text/event-stream" } });
    const readerA = resA.body!.getReader();
    const decoder = new TextDecoder();
    let chunkA = "";
    while (!chunkA.includes("endpoint")) {
      const { value, done } = await readerA.read();
      if (done) break;
      chunkA += decoder.decode(value, { stream: true });
    }
    const sessionA = chunkA.match(/sessionId=([a-zA-Z0-9-_]+)/)![1];

    // 客户端 B
    const ctrlB = new AbortController();
    const resB = await fetch(`${baseUrl}/sse`, { signal: ctrlB.signal, headers: { Accept: "text/event-stream" } });
    const readerB = resB.body!.getReader();
    let chunkB = "";
    while (!chunkB.includes("endpoint")) {
      const { value, done } = await readerB.read();
      if (done) break;
      chunkB += decoder.decode(value, { stream: true });
    }
    const sessionB = chunkB.match(/sessionId=([a-zA-Z0-9-_]+)/)![1];

    expect(sessionA).not.toBe(sessionB);

    // 两个客户端同时发送不同请求
    const postA = await fetch(`${baseUrl}/message?sessionId=${sessionA}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req_A",
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "clientA", version: "1.0" } },
      }),
    });
    expect(postA.status).toBe(202);

    const postB = await fetch(`${baseUrl}/message?sessionId=${sessionB}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "req_B",
        method: "initialize",
        params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "clientB", version: "1.0" } },
      }),
    });
    expect(postB.status).toBe(202);

    ctrlA.abort();
    ctrlB.abort();
  });

  describe("SSE 强身份令牌鉴权 (MCP_SSH_AUTH_TOKEN)", () => {
    let authServer: RunningSSEServer;
    let authBaseUrl: string;
    const testSecret = "my-super-secret-token-123456";

    beforeEach(async () => {
      authServer = await startSSEServer({
        authToken: testSecret,
        serverFactory: () => {
          const s = new McpServer({
            name: "mcp-server-ssh-auth-test",
            version: "1.0.0-test",
          });
          return s;
        },
        host: "127.0.0.1",
        port: 0,
      });
      authBaseUrl = `http://127.0.0.1:${authServer.port}`;
    });

    afterEach(async () => {
      if (authServer) {
        await authServer.close();
      }
    });

    it("未提供 Token 时访问 GET /sse 应返回 401 Unauthorized", async () => {
      const res = await fetch(`${authBaseUrl}/sse`);
      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toContain("Unauthorized");
    });

    it("提供错误 Token 时访问 GET /sse 应返回 401 Unauthorized", async () => {
      const res = await fetch(`${authBaseUrl}/sse`, {
        headers: { Authorization: "Bearer wrong-token" },
      });
      expect(res.status).toBe(401);
    });

    it("未提供 Token 时访问 POST /message 应返回 401 Unauthorized", async () => {
      const res = await fetch(`${authBaseUrl}/message?sessionId=any-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });
      expect(res.status).toBe(401);
    });

    it("通过 Authorization: Bearer <token> 鉴权成功建立 SSE 连接", async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${authBaseUrl}/sse`, {
        signal: ctrl.signal,
        headers: {
          Accept: "text/event-stream",
          Authorization: `Bearer ${testSecret}`,
        },
      });
      expect(res.status).toBe(200);
      ctrl.abort();
    });

    it("通过 ?token=<token> 查询参数鉴权成功建立 SSE 连接", async () => {
      const ctrl = new AbortController();
      const res = await fetch(`${authBaseUrl}/sse?token=${testSecret}`, {
        signal: ctrl.signal,
        headers: {
          Accept: "text/event-stream",
        },
      });
      expect(res.status).toBe(200);
      ctrl.abort();
    });

    it("配置 Token 后健康检查 GET /health 仍应保持免密", async () => {
      const res = await fetch(`${authBaseUrl}/health`);
      expect(res.status).toBe(200);
    });

    it("verifyAuthToken 工具函数在不同长度或非法输入时正确执行常数时间安全比对", () => {
      expect(verifyAuthToken("correct-token", "correct-token")).toBe(true);
      expect(verifyAuthToken("wrong-token", "correct-token")).toBe(false);
      expect(verifyAuthToken("short", "much-longer-expected-token")).toBe(false);
      expect(verifyAuthToken(undefined, "expected-token")).toBe(false);
      expect(verifyAuthToken("", "expected-token")).toBe(false);
      expect(verifyAuthToken(null as any, "expected-token")).toBe(false);
    });
  });
});

