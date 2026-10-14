/**
 * 安全审计事件模型与汇聚端契约定义
 *
 * 遵循统一领域语言 (Ubiquitous Language) 与 ADR-0014
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { z } from "zod";

/**
 * 审计事件安全严重级别
 *
 * - info: 普通只读查询、状态巡检、正常物理建连与断连
 * - warn: 资源截断、柔性降级、超时自动回收
 * - error: 命令执行失败、退出码非零、网络鉴权异常
 * - security: 高危拦截、Sudo 特权提权、危险命令强制放行
 */
export type AuditLevel = "info" | "warn" | "error" | "security";

/**
 * 审计事件业务领域分类
 */
export type AuditCategory =
  | "connection"
  | "exec"
  | "session"
  | "sftp"
  | "tunnel"
  | "job"
  | "safety"
  | "tool";

/**
 * 审计事件执行状态
 */
export type AuditStatus = "success" | "failure" | "blocked";

/**
 * 审计事件源
 */
export type AuditSource = "mcp_tool" | "service_internal";

/**
 * 远程目标连接元数据摘要
 */
export interface AuditTargetMeta {
  /**
   * 目标主机名或 IP
   */
  host?: string;

  /**
   * 目标 SSH 端口
   */
  port?: number;

  /**
   * 目标登录用户名
   */
  user?: string;
}

/**
 * 执行结果合规度量
 */
export interface AuditResult {
  /**
   * 最终执行状态
   */
  status: AuditStatus;

  /**
   * 操作耗时毫秒数
   */
  durationMs: number;

  /**
   * 进程退出码 (若有)
   */
  exitCode?: number;

  /**
   * 异常错误摘要 (若失败)
   */
  error?: string;
}


/**
 * 标准单条审计事件载荷 (Audit Event)
 */
export interface AuditEvent {
  /**
   * 全局唯一事件 ID (UUID v4)
   */
  id: string;

  /**
   * 精确事件生成时间 (ISO 8601 UTC)
   */
  timestamp: string;

  /**
   * 安全严重级别
   */
  level: AuditLevel;

  /**
   * 业务领域分类
   */
  category: AuditCategory;

  /**
   * 具体触发动作 (如 "ssh_exec", "escalate_sudo", "safety_blocked")
   */
  action: string;

  /**
   * 关联的物理网络连接 ID
   */
  connectionId?: string;

  /**
   * 目标主机元数据
   */
  target?: AuditTargetMeta;

  /**
   * 已经过凭据脱敏引擎清洗的请求入参快照
   */
  params?: Record<string, unknown>;

  /**
   * 执行结果度量
   */
  result: AuditResult;

  /**
   * 产生源 (顶层 MCP 工具调用或底层服务内部)
   */
  source: AuditSource;

  /**
   * 扩展业务详情
   */
  details?: Record<string, unknown>;
}

/**
 * 审计汇聚端接口契约 (Audit Sink)
 */
export interface AuditSink {
  /**
   * 写入单条审计事件
   *
   * @param event 结构化审计事件对象
   */
  write(event: AuditEvent): Promise<void> | void;

  /**
   * 优雅刷新并关闭汇聚端流
   */
  close(): Promise<void> | void;
}
