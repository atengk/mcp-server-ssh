/**
 * 受管脱机后台作业数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { z } from "zod";

/**
 * 启动脱机后台作业入参 Schema
 */
export const SSHJobStartParamsSchema = z.object({
  command: z.string().min(1, "执行命令不能为空").describe("待在远程后台脱机运行的长耗时命令"),
  cwd: z.string().optional().describe("作业执行工作目录（缺省时使用用户登录主目录）"),
  env: z.record(z.string()).optional().describe("注入作业环境的环境变量键值对"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHJobStartParams = z.infer<typeof SSHJobStartParamsSchema>;

/**
 * 启动脱机后台作业返回结果 Schema
 */
export const SSHJobStartResultSchema = z.object({
  jobId: z.string().describe("生成的作业唯一标识符"),
  pid: z.number().int().describe("远程脱机运行的操作系统进程 ID"),
  jobDir: z.string().describe("该作业在远程主机的独立工作目录绝对路径（~/.mcp_jobs/<jobId>）"),
});

export type SSHJobStartResult = z.infer<typeof SSHJobStartResultSchema>;

/**
 * 查询脱机后台作业状态入参 Schema
 */
export const SSHJobStatusParamsSchema = z.object({
  jobId: z.string().min(1, "作业标识符不能为空").describe("待查询的后台作业 ID"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHJobStatusParams = z.infer<typeof SSHJobStatusParamsSchema>;

/**
 * 脱机后台作业运行状态枚举
 */
export const JobStatusEnum = z.enum(["running", "completed", "failed", "killed", "unknown"]);
export type JobStatus = z.infer<typeof JobStatusEnum>;

/**
 * 查询脱机后台作业状态返回结果 Schema
 */
export const SSHJobStatusResultSchema = z.object({
  jobId: z.string().describe("作业唯一标识符"),
  status: JobStatusEnum.describe("作业运行状态：running (运行中), completed (正常完成), failed (异常退出), killed (被信号终止)"),
  pid: z.number().int().describe("远程进程 ID"),
  exitCode: z.number().int().nullable().describe("作业退出码（运行中时为 null，0 表示正常退出）"),
  command: z.string().describe("原始提交的命令内容"),
});

export type SSHJobStatusResult = z.infer<typeof SSHJobStatusResultSchema>;

/**
 * 分段读取脱机后台作业日志入参 Schema
 */
export const SSHJobLogsParamsSchema = z.object({
  jobId: z.string().min(1, "作业标识符不能为空").describe("目标后台作业 ID"),
  offsetLines: z.number().int().nonnegative().default(0).describe("从第几行开始读取（0-indexed，用于分页与增量拉取），默认 0"),
  maxLines: z.number().int().positive().default(200).describe("本次读取的最大行数，默认 200 行"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHJobLogsParams = z.infer<typeof SSHJobLogsParamsSchema>;

/**
 * 分段读取脱机后台作业日志返回结果 Schema
 */
export const SSHJobLogsResultSchema = z.object({
  jobId: z.string().describe("作业唯一标识符"),
  lines: z.array(z.string()).describe("本次读取的日志文本行列表"),
  totalLines: z.number().int().describe("日志文件当前总行数"),
  hasMore: z.boolean().describe("是否还有后续未读日志行"),
});

export type SSHJobLogsResult = z.infer<typeof SSHJobLogsResultSchema>;

/**
 * 终止脱机后台作业入参 Schema
 */
export const SSHJobKillParamsSchema = z.object({
  jobId: z.string().min(1, "作业标识符不能为空").describe("待终止的目标作业 ID"),
  signal: z.string().default("SIGTERM").describe("发送的终止信号（如 SIGTERM 或 SIGKILL），默认 SIGTERM"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHJobKillParams = z.infer<typeof SSHJobKillParamsSchema>;

/**
 * 终止脱机后台作业返回结果 Schema
 */
export const SSHJobKillResultSchema = z.object({
  jobId: z.string().describe("作业唯一标识符"),
  killed: z.boolean().describe("是否成功下发终止信号"),
  pid: z.number().int().describe("被终止的目标进程 ID"),
});

export type SSHJobKillResult = z.infer<typeof SSHJobKillResultSchema>;

/**
 * 清理脱机后台作业工作空间入参 Schema
 */
export const SSHJobCleanParamsSchema = z.object({
  jobId: z.string().optional().describe("若指定则清理特定作业的工作空间；若未指定则批量清理过期作业"),
  maxAgeDays: z.number().int().positive().default(7).describe("若批量清理，超过指定天数无活动的作业将被物理删除，默认 7 天"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHJobCleanParams = z.infer<typeof SSHJobCleanParamsSchema>;

/**
 * 清理脱机后台作业工作空间返回结果 Schema
 */
export const SSHJobCleanResultSchema = z.object({
  cleanedCount: z.number().int().describe("被成功清理的作业工作空间数量"),
});

export type SSHJobCleanResult = z.infer<typeof SSHJobCleanResultSchema>;
