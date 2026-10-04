/**
 * 基于 Node 原生 HTTP 的轻量 MCP SSE 协议传输服务
 *
 * @author Ateng
 * @since 2026-10-04
 */

import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";

/**
 * SSE 服务初始化配置选项
 */
export interface SSEServerOptions {
  server?: McpServer;
  serverFactory?: () => McpServer;
  host?: string;
  port?: number;
  serviceVersion?: string;
}

/**
 * 正在运行的 SSE HTTP 服务实例描述
 */
export interface RunningSSEServer {
  httpServer: http.Server;
  host: string;
  port: number;
  close: () => Promise<void>;
}

/**
 * 跨域资源共享 (CORS) 标准响应标头集合
 */
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

/**
 * 为 HTTP 响应写入通用 CORS 标头
 *
 * @param res HTTP 响应对象
 */
function setCorsHeaders(res: ServerResponse): void {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    res.setHeader(key, value);
  }
}

/**
 * 创建并启动 MCP SSE HTTP 服务器
 *
 * @param options SSE 启动参数
 * @return 包含监听信息与优雅停机控制的 RunningSSEServer 实例
 */
export async function startSSEServer(options: SSEServerOptions): Promise<RunningSSEServer> {
  const host = options.host || "0.0.0.0";
  const targetPort = options.port !== undefined ? options.port : 8000;
  const version = options.serviceVersion || "1.1.0";

  // 活跃会话与专属 MCP Server 实例管理器
  const activeTransports = new Map<string, SSEServerTransport>();
  const activeServers = new Map<string, McpServer>();

  const httpServer = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
    setCorsHeaders(res);

    // 1. 处理 CORS 预检请求
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const reqUrl = req.url || "/";
    const parsedUrl = new URL(reqUrl, `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // 2. 健康检查端点
    if ((pathname === "/" || pathname === "/health" || pathname === "/ping") && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "mcp-server-ssh",
          version,
          activeConnections: activeTransports.size,
        })
      );
      return;
    }

    // 3. 建立 SSE 长轮询事件流端点 (/sse)
    if (pathname === "/sse" && req.method === "GET") {
      try {
        const transport = new SSEServerTransport("/message", res);
        const sessionId = transport.sessionId;

        // 优先使用工厂函数动态创建会话专属的 McpServer 实例以支持多客户端并发隔离
        const sessionServer = options.serverFactory
          ? options.serverFactory()
          : options.server;

        if (!sessionServer) {
          throw new Error("启动 SSE 服务失败：未提供 server 或 serverFactory 实例");
        }

        activeTransports.set(sessionId, transport);
        activeServers.set(sessionId, sessionServer);

        transport.onclose = async () => {
          activeTransports.delete(sessionId);
          const serverToClose = activeServers.get(sessionId);
          activeServers.delete(sessionId);
          if (serverToClose && options.serverFactory) {
            try {
              await serverToClose.close();
            } catch {
              // 忽略单个关闭异常
            }
          }
        };

        // 挂载至会话专属 MCP Server (Server.connect 会在内部自动调用 transport.start())
        await sessionServer.connect(transport);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`建立 SSE 流失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }

    // 4. 接收客户端 JSON-RPC 消息端点 (/message)
    if (pathname === "/message" && req.method === "POST") {
      const sessionId = parsedUrl.searchParams.get("sessionId");
      if (!sessionId || !activeTransports.has(sessionId)) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("会话不存在或已关闭 (Session not found)");
        return;
      }

      const transport = activeTransports.get(sessionId)!;
      try {
        await transport.handlePostMessage(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "text/plain" });
          res.end(`处理消息失败: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      return;
    }

    // 5. 兜底未匹配路由
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  // 启动 HTTP 服务监听
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(targetPort, host, () => {
      httpServer.removeListener("error", reject);
      resolve();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address !== null ? address.port : targetPort;

  // 优雅停机控制器
  const close = async (): Promise<void> => {
    // 1. 关闭所有活跃 SSE 传输连接
    for (const [id, transport] of activeTransports.entries()) {
      try {
        await transport.close();
      } catch {
        // 忽略单个关闭异常
      }
    }
    activeTransports.clear();

    // 2. 关闭所有专属 McpServer 实例
    for (const [id, s] of activeServers.entries()) {
      if (options.serverFactory) {
        try {
          await s.close();
        } catch {
          // 忽略关闭异常
        }
      }
    }
    activeServers.clear();

    // 3. 强制关闭空闲及长连接并终止 HTTP 监听
    if (typeof httpServer.closeAllConnections === "function") {
      httpServer.closeAllConnections();
    }

    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
  };

  return {
    httpServer,
    host,
    port: actualPort,
    close,
  };
}
