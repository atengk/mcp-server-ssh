/**
 * 零依赖原生文件尺寸监控与轮转器单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileRotator } from "./rotator.js";

describe("原生日志文件尺寸轮转器 (FileRotator) - ADR-0014", () => {
  let tempDir: string;
  let logFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-audit-rotator-test-"));
    logFile = path.join(tempDir, "logs", "sub", "audit.log");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // 忽略清理异常
    }
  });

  it("当目标多级目录不存在时应自动递归创建并正确追加写入", async () => {
    const rotator = new FileRotator({
      filePath: logFile,
      maxSizeBytes: 1024,
      maxFiles: 3,
    });

    await rotator.write("First audit entry\n");
    await rotator.close();

    expect(fs.existsSync(logFile)).toBe(true);
    const content = fs.readFileSync(logFile, "utf-8");
    expect(content).toBe("First audit entry\n");
  });

  it("当写入内容超过单文件大小上限时应触发原子轮转生成 .1 备份", async () => {
    // 设置阈值为 50 字节
    const rotator = new FileRotator({
      filePath: logFile,
      maxSizeBytes: 50,
      maxFiles: 3,
    });

    // 写入 40 字节
    await rotator.write("1234567890123456789012345678901234567890\n"); // 41 字节
    expect(fs.existsSync(`${logFile}.1`)).toBe(false);

    // 再次写入，总和超过 50 字节，应触发轮转
    await rotator.write("Second line triggering rotation\n");
    await rotator.close();

    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    const rotatedContent = fs.readFileSync(`${logFile}.1`, "utf-8");
    expect(rotatedContent).toBe("1234567890123456789012345678901234567890\n");

    const currentContent = fs.readFileSync(logFile, "utf-8");
    expect(currentContent).toBe("Second line triggering rotation\n");
  });

  it("多次连续轮转时应按顺序生成 .1, .2, .3 并严格淘汰超出 maxFiles 的最旧文件", async () => {
    const rotator = new FileRotator({
      filePath: logFile,
      maxSizeBytes: 20,
      maxFiles: 2, // 最多保留 2 份历史备份 (.1 和 .2)
    });

    // 写入第 1 块
    await rotator.write("Chunk 1: 0123456789\n"); // 20 字节
    // 写入第 2 块 -> 触发轮转，Chunk 1 变为 .1，当前写入 Chunk 2
    await rotator.write("Chunk 2: 0123456789\n");
    // 写入第 3 块 -> 触发轮转，Chunk 2 变为 .1，Chunk 1 变为 .2，当前写入 Chunk 3
    await rotator.write("Chunk 3: 0123456789\n");
    // 写入第 4 块 -> 触发轮转，Chunk 1(.2) 被淘汰删除，Chunk 2 变为 .2，Chunk 3 变为 .1，当前写入 Chunk 4
    await rotator.write("Chunk 4: 0123456789\n");
    await rotator.close();

    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(`${logFile}.1`)).toBe(true);
    expect(fs.existsSync(`${logFile}.2`)).toBe(true);
    expect(fs.existsSync(`${logFile}.3`)).toBe(false); // 严格最多保留 2 份

    expect(fs.readFileSync(logFile, "utf-8")).toBe("Chunk 4: 0123456789\n");
    expect(fs.readFileSync(`${logFile}.1`, "utf-8")).toBe("Chunk 3: 0123456789\n");
    expect(fs.readFileSync(`${logFile}.2`, "utf-8")).toBe("Chunk 2: 0123456789\n");
  });

  it("高并发连续写入时应通过队列维持严格原子性与执行顺序", async () => {
    const rotator = new FileRotator({
      filePath: logFile,
      maxSizeBytes: 10000,
      maxFiles: 3,
    });

    // 并发下发 20 条日志
    const writes = Array.from({ length: 20 }, (_, i) =>
      rotator.write(`Entry ${i}\n`)
    );
    await Promise.all(writes);
    await rotator.close();

    const lines = fs.readFileSync(logFile, "utf-8").trim().split("\n");
    expect(lines.length).toBe(20);
    lines.forEach((line, index) => {
      expect(line).toBe(`Entry ${index}`);
    });
  });
});
