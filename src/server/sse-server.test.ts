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
import { startSSEServer, type RunningSSEServer } from "./sse-server.js";

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

  it("健康检查端点 GET /health 应返回 200 与服务元数据", async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
    expect(data.service).toBe("mcp-server-ssh");
  });

  it("根路径 GET / 应返回健康检查状态", async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("ok");
  });

  it("处理 CORS OPTIONS 预检请求应返回 204 及正确标头", async () => {
    const res = await fetch(`${baseUrl}/sse`, {
      method: "OPTIONS",
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
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
});
