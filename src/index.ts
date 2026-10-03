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
import { SSHConfigParser } from "./connection/config-parser.js";
import { ConnectionPool } from "./connection/manager.js";
import { SSHConnectParamsSchema, SSHDisconnectParamsSchema } from "./types/connection.js";

// 1. 初始化环境变量配置
dotenv.config();

/**
 * MCP Server 初始化装配选项
 */
export interface MCPServerOptions {
  connectionPool?: ConnectionPool;
  configParser?: SSHConfigParser;
}

/**
 * 创建并配置 MCP Server 实例与工具注册
 *
 * @param options 可选注入的连接池与配置解析器
 * @return 配置完成的 McpServer 实例
 */
export function createMCPServer(options?: MCPServerOptions): McpServer {
  const configParser = options?.configParser ?? new SSHConfigParser();
  const pool = options?.connectionPool ?? new ConnectionPool({ configParser });

  const server = new McpServer({
    name: "mcp-server-ssh",
    version: "0.1.0",
  });

  // 1. 注册基础心跳与连通性检测工具
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

  // 2. 注册建立/载入 SSH 连接工具
  server.tool(
    "ssh_connect",
    "建立新的 SSH 主机连接，或依据本地 ~/.ssh/config 别名载入配置",
    SSHConnectParamsSchema.shape,
    async (params) => {
      try {
        const info = await pool.connect(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "connected",
                  message: `成功连接至主机 ${info.host}:${info.port} (${info.username})`,
                  connection: info,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `SSH 连接建立失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 3. 注册断开 SSH 连接工具
  server.tool(
    "ssh_disconnect",
    "断开并关闭指定的 SSH 物理网络连接",
    SSHDisconnectParamsSchema.shape,
    async ({ connectionId }) => {
      const success = await pool.disconnect(connectionId);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                status: success ? "disconnected" : "not_found",
                connectionId,
                message: success ? `已成功断开连接 ${connectionId}` : `未找到指定标识的连接 ${connectionId}`,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 4. 注册列出活跃连接工具
  server.tool(
    "ssh_list_connections",
    "列出当前所有已建立且存活的 SSH 连接与默认路由状态",
    {},
    async () => {
      const connections = pool.listConnections();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total: connections.length,
                connections,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // 5. 注册列出本机预设主机别名工具
  server.tool(
    "ssh_list_config_hosts",
    "读取并列出本地 ~/.ssh/config 中解析到的所有 Host 别名与基本配置",
    {},
    async () => {
      const hosts = configParser.listHosts();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                total: hosts.length,
                hosts,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}

/**
 * 依据环境变量自动预建立默认主机连接
 */
async function autoConnectDefaultHost(pool: ConnectionPool): Promise<void> {
  const host = process.env.SSH_HOST;
  const alias = process.env.SSH_CONFIG_ALIAS;

  if (host || alias) {
    try {
      process.stderr.write(`[mcp-server-ssh] 检测到默认主机配置，正在尝试自动建连 (${alias || host})...\n`);
      const info = await pool.connect({
        host,
        port: process.env.SSH_PORT ? Number.parseInt(process.env.SSH_PORT, 10) : 22,
        username: process.env.SSH_USER,
        password: process.env.SSH_PASSWORD,
        privateKey: process.env.SSH_KEY_PATH,
        passphrase: process.env.SSH_KEY_PASSPHRASE,
        sshConfigAlias: alias,
        setAsDefault: true,
      });
      process.stderr.write(`[mcp-server-ssh] 默认主机自动建连成功: ${info.connectionId} -> ${info.host}\n`);
    } catch (err) {
      process.stderr.write(
        `[mcp-server-ssh] 默认主机自动建连失败: ${err instanceof Error ? err.message : String(err)}\n`
      );
    }
  }
}

/**
 * 启动 Stdio 通信传输并监听请求
 */
export async function startServer(): Promise<void> {
  const configParser = new SSHConfigParser();
  const pool = new ConnectionPool({ configParser });
  const server = createMCPServer({ connectionPool: pool, configParser });
  const transport = new StdioServerTransport();

  // 1. 尝试环境变量自动建连
  await autoConnectDefaultHost(pool);

  // 2. 优雅停机信号处理
  const shutdown = async () => {
    process.stderr.write("[mcp-server-ssh] 正在优雅关闭所有连接与服务...\n");
    await pool.closeAll();
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
