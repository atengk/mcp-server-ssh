/**
 * OutputTruncator 输出截断器与 ANSI 剥离单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { describe, expect, it } from "vitest";
import { OutputTruncator } from "./truncator.js";

describe("OutputTruncator 输出截断器与 ANSI 过滤", () => {
  const truncator = new OutputTruncator();

  describe("ANSI 控制序列过滤 (stripAnsi)", () => {
    it("应当彻底剥离终端颜色、加粗等 ANSI 转义码", () => {
      const raw = "\x1B[31mError:\x1B[0m \x1B[1;32mEverything is fine\x1B[0m \x1B[4munderlined\x1B[0m";
      const stripped = truncator.stripAnsi(raw);
      expect(stripped).toBe("Error: Everything is fine underlined");
    });

    it("对无 ANSI 的普通文本应当保持原样", () => {
      const raw = "Linux 6.8.0-45-generic x86_64";
      expect(truncator.stripAnsi(raw)).toBe(raw);
    });
  });

  describe("64KB 双端智能截断 (truncate)", () => {
    it("未超过 64KB 限制的文本应当原样保留且标记 isTruncated: false", () => {
      const text = "Normal output line 1\nNormal output line 2\n";
      const result = truncator.truncate(text);
      expect(result.isTruncated).toBe(false);
      expect(result.text).toBe(text);
      expect(result.originalBytes).toBe(Buffer.byteLength(text, "utf-8"));
    });

    it("超过 64KB 的文本应当智能保留前 8KB 标头与后 56KB 尾部", () => {
      // 构造约 120KB 的长文本
      const headMarker = "HEADER_START_MARKER_0123456789";
      const tailMarker = "TAIL_ERROR_STACK_CRITICAL_EXCEPTION_9876543210";
      
      const middleChunk = "A".repeat(120 * 1024); // 120KB
      const largeText = `${headMarker}\n${middleChunk}\n${tailMarker}`;

      const result = truncator.truncate(largeText);
      expect(result.isTruncated).toBe(true);
      expect(result.originalBytes).toBeGreaterThan(100 * 1024);
      // 头部标头应该存在
      expect(result.text).toContain(headMarker);
      // 尾部错误信息应该存在
      expect(result.text).toContain(tailMarker);
      // 中间应当注入安全警告与原始大小
      expect(result.text).toContain("⚠️ MCP 安全警告：输出超出 64KB 限制");
      expect(result.text).toContain(String(result.originalBytes));
    });

    it("支持自定义截断阈值", () => {
      const customTruncator = new OutputTruncator({ maxBytes: 1024 }); // 1KB 上限
      const text = "X".repeat(2048);
      const result = customTruncator.truncate(text);
      expect(result.isTruncated).toBe(true);
      expect(result.originalBytes).toBe(2048);
    });
  });
});
