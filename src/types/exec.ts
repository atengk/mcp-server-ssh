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
});

export type SSHExecParams = z.infer<typeof SSHExecParamsSchema>;

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
  waitForMs: z.number().int().positive().default(1000).describe("等待收集终端响应输出的时间（毫秒），默认 1000ms"),
});

export type SSHSessionSendParams = z.infer<typeof SSHSessionSendParamsSchema>;

/**
 * 关闭交互终端会话入参 Schema
 */
export const SSHSessionCloseParamsSchema = z.object({
  sessionId: z.string().min(1, "会话标识符不能为空").describe("待关闭的 PTY 终端会话 ID"),
});

export type SSHSessionCloseParams = z.infer<typeof SSHSessionCloseParamsSchema>;
