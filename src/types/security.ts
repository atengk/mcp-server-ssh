/**
 * 安全防御与流控截断数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { z } from "zod";

/**
 * 安全拦截规则模型
 */
export const SafetyRuleSchema = z.object({
  id: z.string().describe("规则唯一标识（如 lethal-rm-root）"),
  name: z.string().describe("规则名称"),
  description: z.string().describe("规则描述与危险后果说明"),
  pattern: z.string().describe("用于匹配危险命令的正则表达式字符串"),
  severity: z.enum(["critical", "high", "medium"]).describe("危险严重等级"),
  enabled: z.boolean().default(true).describe("是否启用该规则"),
});

export type SafetyRule = z.infer<typeof SafetyRuleSchema>;

/**
 * 安全检测返回结果
 */
export const SafetyCheckResultSchema = z.object({
  isAllowed: z.boolean().describe("是否允许执行"),
  matchedRule: SafetyRuleSchema.optional().describe("若被拦截，触发的规则详情"),
  reason: z.string().optional().describe("拦截原因或放行提示"),
});

export type SafetyCheckResult = z.infer<typeof SafetyCheckResultSchema>;

/**
 * 输出流截断结果模型
 */
export const TruncationResultSchema = z.object({
  text: z.string().describe("最终输出文本（已截断与净化）"),
  isTruncated: z.boolean().describe("是否发生截断"),
  originalBytes: z.number().describe("原始字节大小"),
  retainedBytes: z.number().describe("截断后保留的字节大小"),
});

export type TruncationResult = z.infer<typeof TruncationResultSchema>;
