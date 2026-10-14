/**
 * 安全审计汇聚端可插拔适配器 (Audit Sink Adapters)
 *
 * 遵循统一领域语言与 ADR-0014
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { FileRotator } from "./rotator.js";
import type { AuditEvent, AuditSink } from "./types.js";

/**
 * 文件汇聚端配置契约
 */
export interface FileAuditSinkOptions {
  /**
   * 目标物理日志文件路径
   */
  filePath: string;

  /**
   * 单文件切分大小上限 (单位: MB)
   */
  maxSizeMb: number;

  /**
   * 保留的历史备份文件数
   */
  maxFiles: number;
}

/**
 * 本地 NDJSON 滚动文件审计汇聚端 (FileAuditSink)
 */
export class FileAuditSink implements AuditSink {
  private readonly rotator: FileRotator;

  /**
   * 构造文件审计汇聚端
   *
   * @param options 文件配置项
   */
  constructor(options: FileAuditSinkOptions) {
    const maxSizeBytes = Math.max(1, options.maxSizeMb) * 1024 * 1024;
    this.rotator = new FileRotator({
      filePath: options.filePath,
      maxSizeBytes,
      maxFiles: options.maxFiles,
    });
  }

  /**
   * 格式化并序列化写入单条审计事件
   *
   * @param event 审计事件载荷
   */
  public async write(event: AuditEvent): Promise<void> {
    const serialized = JSON.stringify(event) + "\n";
    await this.rotator.write(serialized);
  }

  /**
   * 刷新并释放底层流资源
   */
  public async close(): Promise<void> {
    await this.rotator.close();
  }
}

/**
 * 标准错误流审计汇聚端 (StderrAuditSink)
 *
 * 专为 Docker/K8s 容器云原生日志采集代理设计
 */
export class StderrAuditSink implements AuditSink {
  /**
   * 将结构化单行 JSON 输出至 stderr
   *
   * @param event 审计事件载荷
   */
  public write(event: AuditEvent): void {
    const serialized = JSON.stringify(event) + "\n";
    process.stderr.write(serialized);
  }

  /**
   * 无状态流直接就绪关闭
   */
  public close(): void {
    // stderr 由 Node 进程生命周期托管
  }
}

