/**
 * CLI 终端帮助文档格式化器
 *
 * @author Ateng
 * @since 2026-10-14
 */

export const SERVICE_VERSION = "1.2.5";

/**
 * 生成并格式化完整的 CLI 帮助文档
 *
 * @return 帮助手册文本内容
 */
export function getHelpText(): string {
  return `
mcp-server-ssh v${SERVICE_VERSION}
基于 OpenSSH 协议连接并操控远程 Linux/Unix 系统的 Model Context Protocol (MCP) 服务

使用方式:
  mcp-server-ssh [选项]

命令选项:
  -h, --help      显示帮助文档并立即退出
  -v, --version   显示当前版本号并立即退出
  --doctor        运行四维全景自检排障套件 (环境、凭据、网络与目标连通性)

传输承载模式 (Transport Modes):
  stdio (默认)    通过进程标准输入输出管道交换 JSON-RPC 消息 (适用于 Claude Desktop, Cursor 等本地宿主)
  sse             启动轻量 HTTP SSE 长轮询网络服务 (通过环境变量 MCP_SSH_TRANSPORT=sse 激活)

核心规范环境变量 (Canonical Environment Variables, 100% 遵守 MCP_SSH_* 命名空间):
  MCP_SSH_HOST                  预建连目标主机名或 IP 地址
  MCP_SSH_PORT                  预建连目标 SSH 端口 (默认: 22)
  MCP_SSH_USER                  预建连登录用户名 (缺省时自动使用本地当前系统登录名)
  MCP_SSH_PASSWORD              预建连明文密码
  MCP_SSH_PRIVATE_KEY_PATH      预建连本地私钥文件绝对路径
  MCP_SSH_PRIVATE_KEY           预建连 PEM 私钥文本 (支持包含 \\n)
  MCP_SSH_PRIVATE_KEY_BASE64    预建连 Base64 编码私钥字符串
  MCP_SSH_KEY_PASSPHRASE        预建连私钥解密密码口令
  MCP_SSH_CONFIG_ALIAS          预建连匹配的 ~/.ssh/config 别名
  MCP_SSH_TRANSPORT             传输承载模式: "stdio" | "sse" (默认: "stdio")
  MCP_SSH_SERVER_HOST           SSE 模式下的监听地址 (默认: "0.0.0.0")
  MCP_SSH_SERVER_PORT           SSE 模式下的监听端口 (默认: 8000)
  MCP_SSH_TIMEOUT               连接就绪超时毫秒数 (默认: 30000)
  MCP_SSH_KEEP_ALIVE_INTERVAL   心跳保活探测间隔毫秒数 (默认: 10000)
  MCP_SSH_ALLOW_DANGEROUS_COMMANDS 严格布尔值 ("true" | "false")，是否放行危险命令
  MCP_SSH_AUDIT_ENABLED         是否启用安全审计 ("true" | "false"，配置路径时自动推导)
  MCP_SSH_AUDIT_LOG_PATH        审计日志物理存储文件路径 (留空时输出至 stderr)
  MCP_SSH_AUDIT_MAX_SIZE_MB     单日志文件轮转大小上限 MB (默认: 10)
  MCP_SSH_AUDIT_MAX_FILES       保留的历史切分备份文件数量 (默认: 5)
  MCP_SSH_AUDIT_STRICT          是否启用严格审计熔断 ("true" | "false"，默认: false 柔性降级)


内置 MCP 工具能力矩阵 (共 29 项原子工具):
  - 核心执行: ssh_exec (无状态执行与 Sudo 提权), ssh_ping (网络心跳与延迟探测)
  - 交互终端: ssh_session_start, ssh_session_send (含 expectPattern), ssh_session_close
  - 文件传输: sftp_read_file, sftp_write_file, sftp_upload, sftp_download,
              sftp_upload_dir (Tar流式+排除过滤), sftp_download_dir, sftp_patch_file
  - 端口转发: ssh_forward_port (统摄 local / remote / SOCKS5 动态代理), ssh_tunnel_list, ssh_tunnel_close
  - 后台作业: ssh_job_start (用户态脱机解耦), ssh_job_status, ssh_job_logs, ssh_job_kill, ssh_job_clean
  - 系统诊断: ssh_system_diagnose (硬件/架构/内存/负载/监听端口只读巡检)

快速上手示例:
  # 查看帮助与排障诊断
  $ npx @atengk/mcp-server-ssh --help
  $ npx @atengk/mcp-server-ssh --doctor

  # 作为默认连接预启动
  $ MCP_SSH_HOST=192.168.1.100 MCP_SSH_USER=ubuntu npx @atengk/mcp-server-ssh
`.trim();
}
