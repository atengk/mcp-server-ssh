/**
 * SSH 连接与凭证管理数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { z } from "zod";

/**
 * 建立 SSH 连接参数 Schema
 */
export const SSHConnectParamsSchema = z.object({
  host: z.string().min(1, "目标主机地址不能为空").optional().describe("目标 Linux 服务器的主机名或 IP 地址"),
  port: z.number().int().min(1).max(65535).default(22).describe("SSH 端口号，默认 22"),
  username: z.string().min(1, "登录用户名不能为空").optional().describe("登录远程主机的用户名"),
  password: z.string().optional().describe("登录密码（可选，优先推荐使用密钥认证）"),
  privateKey: z.string().optional().describe("PEM/OpenSSH 格式的私钥内容，或私钥文件的本地绝对路径"),
  passphrase: z.string().optional().describe("若私钥受密码保护，提供解密口令"),
  sshConfigAlias: z.string().optional().describe("本地 ~/.ssh/config 中配置的 Host 别名（如 prod-server）"),
  proxyJump: z.string().optional().describe("跳板机 / 堡垒机别名或连接配置（格式形如 user@bastion:22）"),
  connectionId: z.string().optional().describe("自定义连接标识符，未指定则自动分配唯一 ID"),
  setAsDefault: z.boolean().default(true).describe("是否将该连接设为后续操作的默认活跃连接，默认 true"),
});

export type SSHConnectParams = z.infer<typeof SSHConnectParamsSchema>;

/**
 * 关闭 SSH 连接参数 Schema
 */
export const SSHDisconnectParamsSchema = z.object({
  connectionId: z.string().min(1, "连接标识符不能为空").describe("待关闭的 SSH 连接标识符"),
});

export type SSHDisconnectParams = z.infer<typeof SSHDisconnectParamsSchema>;

/**
 * 连接状态信息模型
 */
export const ConnectionInfoSchema = z.object({
  connectionId: z.string().describe("连接唯一标识符"),
  host: z.string().describe("远程主机地址"),
  port: z.number().describe("远程端口"),
  username: z.string().describe("登录用户名"),
  isDefault: z.boolean().describe("是否为当前默认活跃连接"),
  connectedAt: z.string().describe("连接建立时间（ISO 字符串）"),
  lastActiveAt: z.string().describe("最近活跃通信时间（ISO 字符串）"),
});

export type ConnectionInfo = z.infer<typeof ConnectionInfoSchema>;
