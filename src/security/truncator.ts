/**
 * 终端输出流 64KB 防爆双端截断器与 ANSI 控制字符清洗器
 *
 * @author Ateng
 * @since 2026-10-03
 */

import type { TruncationResult } from "../types/security.js";

/**
 * 默认单次输出上限：64KB (65536 字节)
 */
const DEFAULT_MAX_OUTPUT_BYTES = 65536;

/**
 * 头部保留字节数：8KB (8192 字节)
 */
const DEFAULT_HEAD_BYTES = 8192;

/**
 * 尾部保留字节数：56KB (57344 字节)
 */
const DEFAULT_TAIL_BYTES = 57344;

/**
 * 匹配终端 ANSI 控制序列与彩色转义码的正则表达式
 */
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

/**
 * 输出流控与截断配置选项
 */
export interface OutputTruncatorOptions {
  maxBytes?: number;
  headBytes?: number;
  tailBytes?: number;
}

/**
 * 输出截断与净化处理器
 */
export class OutputTruncator {
  private maxBytes: number;
  private headBytes: number;
  private tailBytes: number;

  public constructor(options?: OutputTruncatorOptions) {
    this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    this.headBytes = options?.headBytes ?? Math.min(DEFAULT_HEAD_BYTES, Math.floor(this.maxBytes / 8));
    this.tailBytes = options?.tailBytes ?? this.maxBytes - this.headBytes;
  }

  /**
   * 剥离文本中包含的 ANSI 彩色转义码与光标控制字符
   *
   * @param text 包含 ANSI 转义序列的原生终端输出
   * @return 净化后的纯文本
   */
  public stripAnsi(text: string): string {
    if (!text) {
      return "";
    }
    return text.replace(ANSI_REGEX, "");
  }

  /**
   * 对输出文本执行 64KB 阈值双端智能截断
   *
   * @param text 待处理的原始文本（建议已剥离 ANSI）
   * @param overrideMaxBytes 可选覆盖的截断阈值大小
   * @return 包含截断后文本与元数据的结果对象
   */
  public truncate(text: string, overrideMaxBytes?: number): TruncationResult {
    if (!text) {
      return {
        text: "",
        isTruncated: false,
        originalBytes: 0,
        retainedBytes: 0,
      };
    }

    const limit = overrideMaxBytes ?? this.maxBytes;
    const buf = Buffer.from(text, "utf-8");
    const originalBytes = buf.length;

    // 1. 若未超出限制，原样返回
    if (originalBytes <= limit) {
      return {
        text,
        isTruncated: false,
        originalBytes,
        retainedBytes: originalBytes,
      };
    }

    // 2. 超出阈值，计算头尾切割点
    const effectiveHead = Math.min(this.headBytes, Math.floor(limit / 8));
    const effectiveTail = limit - effectiveHead;

    const headSlice = buf.subarray(0, effectiveHead).toString("utf-8");
    const tailSlice = buf.subarray(originalBytes - effectiveTail).toString("utf-8");

    const warningNotice = `\n\n[... ⚠️ MCP 安全警告：输出超出 64KB 限制，已自动保留头部 8KB 与尾部 56KB（原始总计 ${originalBytes} 字节）。如需查看完整大日志，请使用 sftp_download 工具下载到本地，或使用 grep/tail 命令过滤 ...]\n\n`;

    const combinedText = `${headSlice}${warningNotice}${tailSlice}`;
    const retainedBytes = Buffer.byteLength(combinedText, "utf-8");

    return {
      text: combinedText,
      isTruncated: true,
      originalBytes,
      retainedBytes,
    };
  }

  /**
   * 组合处理：先剥离 ANSI 控制字符，后实施截断保护
   *
   * @param rawText 原始终端输出文本
   * @return 净化且截断后的安全输出
   */
  public process(rawText: string): TruncationResult {
    const cleaned = this.stripAnsi(rawText);
    return this.truncate(cleaned);
  }
}
