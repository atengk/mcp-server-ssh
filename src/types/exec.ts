/**
 * 远程命令执行与交互式 PTY 会话数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { z } from "zod";

/**
 * 无状态单命令执行入参 Schema
 */
export const SSHExecParamsSchema = z.object({
  command: z.string().min(1, "执行命令不能为空").describe("待在远程 Linux 系统执行的 Bash/Shell 命令"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时自动路由至当前默认活跃连接"),
  cwd: z.string().optional().describe("初始执行工作目录（自动包装为 cd <cwd> && <command>）"),
  timeoutMs: z.number().int().positive().default(60000).describe("执行超时时间（毫秒），默认 60000ms (1分钟)"),
  env: z.record(z.string()).optional().describe("注入远程环境的环境变量键值对"),
  dryRun: z.boolean().default(false).describe("是否仅通过安全拦截守卫检测合规性，而不真正下发执行，默认 false"),
  rawExec: z.boolean().default(false).describe("是否绕过登录 Shell 包装（bash -l -c），直接以非登录 Shell 原生执行，默认 false"),
  sudo: z.boolean().default(false).describe("是否以 sudo 特权身份执行命令（默认 false）。若为 true，自动通过 SSH Channel Stdin 管道流式安全注入提权密码，零命令行明文泄露"),
  sudoPassword: z.string().optional().describe("sudo 提权专用密码。若未提供，则自动复用当前 SSH 连接的登录密码"),
  dangerouslySkipSafetyCheck: z
    .boolean()
    .default(false)
    .describe("是否强制跳过前置高危安全拦截规则（危险操作逃生门，需同时配置环境变量 SSH_ALLOW_DANGEROUS_COMMANDS=true 授权）"),
});

export type SSHExecParams = z.infer<typeof SSHExecParamsSchema>;
export type SSHExecInputParams = z.input<typeof SSHExecParamsSchema>;

/**
 * 无状态命令执行返回结果 Schema
 */
export const SSHExecResultSchema = z.object({
  exitCode: z.number().int().describe("进程退出码，0 表示正常成功退出"),
  stdout: z.string().describe("标准输出文本（已剥离 ANSI 控制字符且经过 64KB 智能截断保护）"),
  stderr: z.string().describe("标准错误输出文本"),
  executionTimeMs: z.number().describe("命令执行实际耗时（毫秒）"),
  isTruncated: z.boolean().describe("输出是否由于超出 64KB 限制被截断"),
  totalBytes: z.number().describe("原始输出总字节数"),
});

export type SSHExecResult = z.infer<typeof SSHExecResultSchema>;

/**
 * 创建交互式 PTY 终端会话入参 Schema
 */
export const SSHSessionStartParamsSchema = z.object({
  connectionId: z.string().optional().describe("目标连接标识符，缺省时自动路由至当前默认连接"),
  cols: z.number().int().positive().default(120).describe("伪终端列数宽度，默认 120"),
  rows: z.number().int().positive().default(30).describe("伪终端行数高度，默认 30"),
});

export type SSHSessionStartParams = z.infer<typeof SSHSessionStartParamsSchema>;

/**
 * 向持久 PTY 终端发送输入或控制字符入参 Schema
 */
export const SSHSessionSendParamsSchema = z.object({
  sessionId: z.string().min(1, "会话标识符不能为空").describe("目标持久 PTY 终端会话 ID"),
  input: z.string().describe("待发送的数据内容或控制字符（如 '\\x03' 发送 Ctrl+C）"),
  waitForMs: z.number().int().positive().default(1000).describe("若未指定 expectPattern，等待收集终端响应输出的时间（毫秒），默认 1000ms"),
  expectPattern: z
    .string()
    .optional()
    .describe("用于主动检测命令完成或 Shell 提示符的正则表达式模式字符串（如 '[$#>:]\\s*$'），匹配即刻响应返回"),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .default(30000)
    .describe("当指定 expectPattern 时，最长等待模式匹配超时时间（毫秒），默认 30000ms (30秒)"),
});

export type SSHSessionSendParams = z.infer<typeof SSHSessionSendParamsSchema>;

/**
 * 关闭交互终端会话入参 Schema
 */
export const SSHSessionCloseParamsSchema = z.object({
  sessionId: z.string().min(1, "会话标识符不能为空").describe("待关闭的 PTY 终端会话 ID"),
});

export type SSHSessionCloseParams = z.infer<typeof SSHSessionCloseParamsSchema>;

/**
 * 多主机批量无状态命令执行入参 Schema（复用单机执行参数契约并扩展批量调度选项）
 */
export const SSHBatchExecParamsSchema = SSHExecParamsSchema.omit({
  connectionId: true,
}).extend({
  targets: z
    .array(z.string().min(1))
    .min(1, "目标主机列表不能为空")
    .describe(
      "目标主机选择器列表（支持主机别名、连接 ID、'@all_active'、'@all_configured' 或通配符如 'web-*'）"
    ),
  mode: z
    .enum(["parallel", "serial"])
    .default("parallel")
    .describe("批量调度模式：parallel（受控并发，默认）或 serial（顺序串行）"),
  concurrency: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe("parallel 并发模式下的最大并发数上限（1-20，默认 5）"),
  stopOnError: z
    .boolean()
    .default(false)
    .describe("serial 串行模式下遇到节点失败或非 0 退出码时是否立即中断后续节点执行（默认 false）"),
});

export type SSHBatchExecParams = z.infer<typeof SSHBatchExecParamsSchema>;
export type SSHBatchExecInputParams = z.input<typeof SSHBatchExecParamsSchema>;

/**
 * 批量执行单节点结果状态模型 Schema
 */
export const SSHBatchNodeResultSchema = z.object({
  target: z.string().describe("目标主机标识"),
  status: z
    .enum(["success", "failed", "skipped"])
    .describe("节点执行状态：success（成功）、failed（失败）或 skipped（串行中断跳过）"),
  exitCode: z
    .number()
    .int()
    .nullable()
    .describe("远程进程退出码（未执行或建连失败时为 null）"),
  stdout: z
    .string()
    .describe("标准输出文本（已剥离 ANSI 控制字符且经过 16KB 紧凑截断保护）"),
  stderr: z.string().describe("标准错误输出文本"),
  executionTimeMs: z.number().describe("该节点实际执行耗时（毫秒）"),
  isTruncated: z.boolean().describe("输出是否因超出 16KB 预算而被截断"),
  totalBytes: z.number().describe("原始输出总字节数"),
  error: z.string().optional().describe("当建连失败、熔断拦截或超时异常时的错误详情"),
});

export type SSHBatchNodeResult = z.infer<typeof SSHBatchNodeResultSchema>;

/**
 * 多主机批量命令执行聚合返回结果 Schema
 */
export const SSHBatchExecResultSchema = z.object({
  command: z.string().describe("执行的命令"),
  mode: z.enum(["parallel", "serial"]).describe("执行调度模式"),
  dryRun: z.boolean().describe("是否为 dryRun 预检模式"),
  totalTargets: z.number().int().describe("展开去重后的目标主机总数"),
  succeeded: z.number().int().describe("执行成功的节点数"),
  failed: z.number().int().describe("执行失败的节点数"),
  skipped: z.number().int().describe("因串行遇错中断而跳过的节点数"),
  executionTimeMs: z.number().describe("批量任务总耗时（毫秒）"),
  results: z
    .record(z.string(), SSHBatchNodeResultSchema)
    .describe("按目标主机标识索引的各节点独立执行结果映射"),
});

export type SSHBatchExecResult = z.infer<typeof SSHBatchExecResultSchema>;
