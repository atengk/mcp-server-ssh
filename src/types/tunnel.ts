/**
 * SSH 端口转发隧道数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { z } from "zod";

/**
 * 创建本地端口转发入参 Schema
 */
export const SSHForwardPortParamsSchema = z.object({
  remoteHost: z.string().default("127.0.0.1").describe("远程目标主机地址或内网主机名，默认 127.0.0.1"),
  remotePort: z.number().int().min(1).max(65535).describe("远程目标服务端口号（例如 3306、6379）"),
  localHost: z.string().default("127.0.0.1").describe("宿主机本地绑定的监听地址，默认 127.0.0.1"),
  localPort: z
    .number()
    .int()
    .min(0)
    .max(65535)
    .optional()
    .describe("宿主机本地监听端口，传 0 或缺省时自动分配空闲随机端口"),
  idleTimeoutSeconds: z
    .number()
    .int()
    .positive()
    .default(300)
    .describe("空闲自动超时释放时间（秒），默认 300 秒无流量自动关闭隧道以防泄漏"),
  connectionId: z.string().optional().describe("使用的 SSH 物理连接标识符，缺省时使用当前默认连接"),
});

export type SSHForwardPortParams = z.infer<typeof SSHForwardPortParamsSchema>;

/**
 * 关闭 SSH 端口转发隧道入参 Schema
 */
export const SSHTunnelCloseParamsSchema = z.object({
  tunnelId: z.string().min(1, "隧道标识符不能为空").describe("待关闭的端口转发隧道 ID"),
});

export type SSHTunnelCloseParams = z.infer<typeof SSHTunnelCloseParamsSchema>;

/**
 * 端口转发隧道状态与元数据模型
 */
export const TunnelInfoSchema = z.object({
  tunnelId: z.string().describe("隧道唯一标识符"),
  localHost: z.string().describe("本地监听地址"),
  localPort: z.number().describe("本地实际监听端口"),
  remoteHost: z.string().describe("远程目标主机"),
  remotePort: z.number().describe("远程目标端口"),
  connectionId: z.string().describe("绑定的 SSH 物理连接标识符"),
  activeSockets: z.number().describe("当前活跃代理客户端 Socket 数量"),
  bytesTransferred: z.number().describe("累计流经隧道的传输总字节数"),
  createdAt: z.string().describe("隧道创建时间（ISO 字符串）"),
  lastActiveAt: z.string().describe("最近活跃数据流时间（ISO 字符串）"),
  idleTimeoutSeconds: z.number().describe("空闲熔断超时秒数"),
});

export type TunnelInfo = z.infer<typeof TunnelInfoSchema>;
