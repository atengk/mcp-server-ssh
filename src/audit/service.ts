/**
 * 安全审计调度引擎 (AuditService)
 *
 * 统一承接全生命周期审计事件，实施凭据脱敏清洗与双模容错策略 (ADR-0014)
 *
 * @author Ateng
 * @since 2026-10-14
 */

import crypto from "node:crypto";
import type { AuditConfig } from "../config/env.js";
import { sanitizeParams } from "./sanitizer.js";
import { FileAuditSink, StderrAuditSink } from "./sink.js";
import type { AuditEvent, AuditSink, AuditTargetMeta } from "./types.js";

/**
 * 安全审计调度与合规中枢服务
 */
export class AuditService {
  private readonly config: AuditConfig;
  private readonly sink: AuditSink | null = null;

  /**
   * 构造审计中枢服务实例
   *
   * @param config 规范审计配置 (支持局部缺省)
   * @param customSink 可选自定义汇聚端适配器 (用于测试或扩展)
   */
  constructor(config?: Partial<AuditConfig>, customSink?: AuditSink) {
    this.config = {
      enabled: config?.enabled ?? false,
      logPath: config?.logPath,
      maxSizeMb: config?.maxSizeMb ?? 10,
      maxFiles: config?.maxFiles ?? 5,
      strict: config?.strict ?? false,
    };

    if (customSink) {
      this.sink = customSink;
    } else if (this.config.enabled) {
      if (this.config.logPath) {
        this.sink = new FileAuditSink({
          filePath: this.config.logPath,
          maxSizeMb: this.config.maxSizeMb,
          maxFiles: this.config.maxFiles,
        });
      } else {
        this.sink = new StderrAuditSink();
      }
    }
  }


  /**
   * 当前是否已激活审计记录功能
   *
   * @return 是否已成功初始化汇聚端并开启审计
   */
  public isEnabled(): boolean {
    return this.config.enabled && this.sink !== null;
  }

  /**
   * 记录单条结构化审计事件
   *
   * 自动注入全局唯一 UUID、ISO 时间戳，并对入参执行深度递归脱敏
   *
   * @param eventPartial 审计事件核心业务属性
   */
  public async log(eventPartial: Omit<AuditEvent, "id" | "timestamp">): Promise<void> {
    if (!this.isEnabled() || !this.sink) {
      return;
    }

    // 1. 深度脱敏清洗请求参数
    const sanitizedParams = eventPartial.params
      ? (sanitizeParams(eventPartial.params) as Record<string, unknown>)
      : undefined;

    // 2. 组装具备唯一追溯证据链的完整事件对象
    const fullEvent: AuditEvent = {
      ...eventPartial,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      params: sanitizedParams,
    };

    // 3. 执行写入并应用双模容错守卫 (Fail-Safe vs. Fail-Closed)
    try {
      await this.sink.write(fullEvent);
    } catch (err) {
      if (this.config.strict) {
        throw err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp-server-ssh] [AUDIT ERROR] 审计日志写入异常: ${message}\n`);
      }
    }
  }

  /**
   * 环绕记录 MCP 工具调用全生命周期 (包括执行耗时与成败状态)
   *
   * @param toolName MCP 工具名称
   * @param params 调用入参
   * @param handler 实际工具执行异步委托
   * @param connectionId 物理连接标识
   * @param target 目标主机信息
   * @return 工具执行原样返回值
   */
  public async recordToolCall<T>(
    toolName: string,
    params: Record<string, unknown> | undefined,
    handler: () => Promise<T>,
    connectionId?: string,
    target?: AuditTargetMeta
  ): Promise<T> {
    if (!this.isEnabled()) {
      return handler();
    }

    const startTime = Date.now();
    let result!: T;
    let thrownError: unknown;

    try {
      result = await handler();
    } catch (err) {
      thrownError = err;
    }

    const durationMs = Date.now() - startTime;
    const isThrown = thrownError !== undefined;
    const isResultError =
      !isThrown && typeof result === "object" && result !== null && (result as any).isError === true;
    const isError = isThrown || isResultError;

    let errorMessage: string | undefined;
    if (isThrown) {
      errorMessage = thrownError instanceof Error ? thrownError.message : String(thrownError);
    } else if (isResultError && Array.isArray((result as any).content)) {
      errorMessage = (result as any).content[0]?.text;
    }

    await this.log({
      level: isError ? "error" : "info",
      category: "tool",
      action: toolName,
      connectionId: connectionId ?? (params?.connectionId as string | undefined),
      target,
      params,
      result: {
        status: isError ? "failure" : "success",
        durationMs,
        error: errorMessage,
      },
      source: "mcp_tool",
    });

    if (isThrown) {
      throw thrownError;
    }
    return result;
  }


  /**
   * 优雅关闭与刷新审计底层流资源
   */
  public async close(): Promise<void> {
    if (this.sink) {
      await this.sink.close();
    }
  }
}
