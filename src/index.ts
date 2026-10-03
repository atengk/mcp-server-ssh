/**
 * MCP Server 核心装配入口与 Stdio 传输协调器
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import dotenv from "dotenv";
import { z } from "zod";

// 1. 初始化环境变量配置
dotenv.config();

/**
 * 创建并配置 MCP Server 实例与工具注册
 *
 * @return 配置完成的 McpServer 实例
 */
export function createMCPServer(): McpServer {
  const server = new McpServer({
    name: "mcp-server-ssh",
    version: "0.1.0",
  });

  // 注册基础心跳与连通性检测工具
  server.tool(
    "ssh_ping",
    "测试 SSH MCP 服务的存活状态、版本信息与通信延迟",
    {
      message: z.string().optional().describe("回显自定义消息内容"),
    },
    async ({ message }) => {
      const payload = {
        status: "ok",
        service: "mcp-server-ssh",
        version: "0.1.0",
        echo: message ?? "pong",
        timestamp: new Date().toISOString(),
      };

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

/**
 * 启动 Stdio 通信传输并监听请求
 */
export async function startServer(): Promise<void> {
  const server = createMCPServer();
  const transport = new StdioServerTransport();

  // 优雅停机信号处理
  const shutdown = async () => {
    process.stderr.write("[mcp-server-ssh] 正在优雅关闭服务...\n");
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  process.stderr.write("[mcp-server-ssh] 服务正在通过 stdio 启动...\n");
  await server.connect(transport);
  process.stderr.write("[mcp-server-ssh] 服务已就绪，正在监听 JSON-RPC 消息\n");
}

// 非测试环境下自动启动服务
if (!process.env.VITEST && process.env.NODE_ENV !== "test") {
  startServer().catch((error) => {
    process.stderr.write(`[mcp-server-ssh] 启动异常退出: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
