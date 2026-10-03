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
import { SafetyGuard } from "./security/guard.js";
import { OutputTruncator } from "./security/truncator.js";
import { ExecService } from "./services/exec-service.js";
import { SessionService } from "./services/session-service.js";
import { SFTPService } from "./services/sftp-service.js";
import { SSHConnectParamsSchema, SSHDisconnectParamsSchema } from "./types/connection.js";
import {
  SSHExecParamsSchema,
  SSHSessionCloseParamsSchema,
  SSHSessionSendParamsSchema,
  SSHSessionStartParamsSchema,
} from "./types/exec.js";
import {
  SFTPDownloadParamsSchema,
  SFTPListDirParamsSchema,
  SFTPMkdirParamsSchema,
  SFTPReadFileParamsSchema,
  SFTPRemoveParamsSchema,
  SFTPStatParamsSchema,
  SFTPUploadParamsSchema,
  SFTPWriteFileParamsSchema,
} from "./types/sftp.js";

// 1. 初始化环境变量配置
dotenv.config();

/**
 * MCP Server 初始化装配选项
 */
export interface MCPServerOptions {
  connectionPool?: ConnectionPool;
  configParser?: SSHConfigParser;
  safetyGuard?: SafetyGuard;
  outputTruncator?: OutputTruncator;
  execService?: ExecService;
  sessionService?: SessionService;
  sftpService?: SFTPService;
}

/**
 * 创建并配置 MCP Server 实例与工具注册
 *
 * @param options 可选注入的底层服务与依赖实例
 * @return 配置完成的 McpServer 实例
 */
export function createMCPServer(options?: MCPServerOptions): McpServer {
  const configParser = options?.configParser ?? new SSHConfigParser();
  const pool = options?.connectionPool ?? new ConnectionPool({ configParser });
  const safetyGuard = options?.safetyGuard ?? new SafetyGuard();
  const outputTruncator = options?.outputTruncator ?? new OutputTruncator();
  const execService =
    options?.execService ??
    new ExecService({
      connectionPool: pool,
      safetyGuard,
      outputTruncator,
    });
  const sessionService =
    options?.sessionService ??
    new SessionService({
      connectionPool: pool,
      safetyGuard,
      outputTruncator,
    });
  const sftpService =
    options?.sftpService ??
    new SFTPService({
      connectionPool: pool,
    });

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

  // 6. 注册无状态命令执行工具 (主力工具)
  server.tool(
    "ssh_exec",
    "在远程 Linux 主机执行单次无状态 Bash/Shell 命令，精准返回退出码、标准输出与标准错误",
    SSHExecParamsSchema.shape,
    async (params) => {
      try {
        const result = await execService.execute(params);
        return {
          isError: result.exitCode !== 0,
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `命令执行异常: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 7. 注册启动交互式 PTY 伪终端会话工具
  server.tool(
    "ssh_session_start",
    "在远程主机启动持久交互式伪终端 (PTY) 会话，支持跨多次输入维持环境状态",
    SSHSessionStartParamsSchema.shape,
    async (params) => {
      try {
        const result = await sessionService.startSession(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "started",
                  sessionId: result.sessionId,
                  message: "已成功启动持久交互式 PTY 伪终端会话",
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
              text: `PTY 终端启动失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 8. 注册向持久终端发送输入/控制信号工具
  server.tool(
    "ssh_session_send",
    "向指定的持久 PTY 终端写入指令或控制信号（如 '\\x03' 发送 Ctrl+C），并收集增量屏幕回显",
    SSHSessionSendParamsSchema.shape,
    async (params) => {
      try {
        const result = await sessionService.sendInput(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `PTY 终端输入交互失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 9. 注册关闭持久终端会话工具
  server.tool(
    "ssh_session_close",
    "关闭指定的持久交互式 PTY 终端会话并回收系统资源",
    SSHSessionCloseParamsSchema.shape,
    async (params) => {
      try {
        const result = await sessionService.closeSession(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: result.closed ? "closed" : "not_found",
                  sessionId: result.sessionId,
                  closed: result.closed,
                  message: result.closed ? "已成功关闭 PTY 终端会话" : "未找到对应的 PTY 终端会话",
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
              text: `PTY 终端关闭异常: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 10. 注册读取远程文本文件工具
  server.tool(
    "sftp_read_file",
    "读取远程主机文本文件内容（单次读取限制 512KB 防爆，超出建议下载）",
    SFTPReadFileParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.readFile(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `读取远程文件失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 11. 注册写入远程文本文件工具
  server.tool(
    "sftp_write_file",
    "写入并覆盖远程主机文本文件（支持自动递归创建父级目录）",
    SFTPWriteFileParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.writeFile(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `写入远程文件失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 12. 注册浏览远程目录工具
  server.tool(
    "sftp_list_dir",
    "列出远程目录下的文件与子目录元数据列表",
    SFTPListDirParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.listDir(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `浏览远程目录失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 13. 注册获取远程文件/目录状态工具
  server.tool(
    "sftp_stat",
    "获取远程文件或目录的 POSIX 详细元数据信息",
    SFTPStatParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.stat(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `获取文件元数据失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 14. 注册创建远程目录工具
  server.tool(
    "sftp_mkdir",
    "在远程主机上创建目录（默认类似 mkdir -p 递归创建上级目录）",
    SFTPMkdirParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.mkdir(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `创建远程目录失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 15. 注册删除远程文件或目录工具
  server.tool(
    "sftp_remove",
    "删除远程文件或目录（支持非空目录递归级联删除，内置防环保护）",
    SFTPRemoveParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.remove(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `删除远程路径失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 16. 注册上传本地文件工具
  server.tool(
    "sftp_upload",
    "将宿主机本地文件快速上传至远程目标主机",
    SFTPUploadParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.upload(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `上传文件失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // 17. 注册下载远程文件工具
  server.tool(
    "sftp_download",
    "将远程主机上的文件快速下载到宿主机本地指定路径",
    SFTPDownloadParamsSchema.shape,
    async (params) => {
      try {
        const result = await sftpService.download(params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `下载文件失败: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
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
