/**
 * 零依赖原生文件尺寸监控与原子轮转器 (FileRotator)
 *
 * 遵循零外部依赖原则与 ADR-0014
 *
 * @author Ateng
 * @since 2026-10-14
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 文件尺寸轮转器配置项
 */
export interface FileRotatorOptions {
  /**
   * 目标物理日志文件路径
   */
  filePath: string;

  /**
   * 单文件最大字节上限 (超出时触发原子切分)
   */
  maxSizeBytes: number;

  /**
   * 最多保留的历史切分备份文件数量
   */
  maxFiles: number;
}

/**
 * 基于 Node.js 原生文件系统实现的原子日志切分器
 */
export class FileRotator {
  private readonly options: FileRotatorOptions;
  private currentSize = -1;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * 构造文件轮转器实例
   *
   * @param options 轮转器配置
   */
  constructor(options: FileRotatorOptions) {
    this.options = options;
  }

  /**
   * 异步顺序写入数据块，并在超过阈值时触发轮转切分
   *
   * @param data 待写入的字符串内容
   * @return 写入完成的 Promise
   */
  public write(data: string): Promise<void> {
    const nextTask = this.writeQueue
      .catch(() => {})
      .then(async () => {
        this.doWrite(data);
      });
    this.writeQueue = nextTask;
    return nextTask;
  }


  /**
   * 等待所有正在排队的写入操作执行完成
   */
  public async close(): Promise<void> {
    await this.writeQueue;
  }

  /**
   * 确保持久化目录与初始文件大小状态就绪
   */
  private ensureInitialized(): void {
    if (this.initialized) {
      return;
    }

    const dir = path.dirname(this.options.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.options.filePath)) {
      try {
        const stat = fs.statSync(this.options.filePath);
        this.currentSize = stat.size;
      } catch {
        this.currentSize = 0;
      }
    } else {
      this.currentSize = 0;
    }

    this.initialized = true;
  }

  /**
   * 执行单次写入操作与尺寸监控
   */
  private doWrite(data: string): void {
    this.ensureInitialized();

    const dataBytes = Buffer.byteLength(data, "utf-8");

    // 当现有文件非空且增加新数据后超过阈值时，执行原子轮转
    if (this.currentSize > 0 && this.currentSize + dataBytes > this.options.maxSizeBytes) {
      this.rotate();
    }

    // 追加写入当前主文件
    fs.appendFileSync(this.options.filePath, data, "utf-8");
    this.currentSize += dataBytes;
  }

  /**
   * 执行原子级日志文件切分与历史备份淘汰
   *
   * audit.log -> audit.log.1 -> audit.log.2 ... -> audit.log.N
   */
  private rotate(): void {
    const { filePath, maxFiles } = this.options;

    if (maxFiles > 0) {
      // 1. 若最旧的备份超出上限，先行删除
      const oldestBackup = `${filePath}.${maxFiles}`;
      if (fs.existsSync(oldestBackup)) {
        try {
          fs.unlinkSync(oldestBackup);
        } catch {
          // 忽略偶发清理竞争
        }
      }

      // 2. 将 .N-1 级联重命名为 .N (倒序执行避免文件覆盖)
      for (let i = maxFiles - 1; i >= 1; i--) {
        const src = `${filePath}.${i}`;
        const dst = `${filePath}.${i + 1}`;
        if (fs.existsSync(src)) {
          try {
            fs.renameSync(src, dst);
          } catch {
            // 容错处理
          }
        }
      }

      // 3. 将当前主文件原子重命名为 .1
      if (fs.existsSync(filePath)) {
        try {
          fs.renameSync(filePath, `${filePath}.1`);
        } catch {
          // 容错处理
        }
      }
    } else {
      // 不保留历史备份时直接清理当前文件
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch {
          // 容错处理
        }
      }
    }

    // 4. 原子重新创建空主文件，确保物理文件时刻就绪
    try {
      fs.writeFileSync(filePath, "", "utf-8");
    } catch {
      // 容错处理
    }

    // 重置当前主文件大小为 0
    this.currentSize = 0;
  }
}

