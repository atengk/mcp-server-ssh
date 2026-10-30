/**
 * 宿主机防爆连接熔断器与冷却期状态机
 *
 * 追踪远程主机连接失败状态并执行冷却期快速拒绝 (Fail-Fast)，防止不可达主机耗尽本地 Socket 与文件描述符
 *
 * @author Ateng
 * @since 2026-10-30
 */

/**
 * 默认连接失败熔断冷却时间（60 秒）
 */
export const DEFAULT_COOLDOWN_MS = 60_000;

/**
 * 批量与快速探测场景默认连接超时时间（6 秒）
 */
export const DEFAULT_CONNECT_TIMEOUT_MS = 6_000;

/**
 * 目标主机处于熔断冷却期时的快速失败专用异常
 */
export class HostInCooldownError extends Error {
  /** 目标主机唯一标识（别名或 host:port） */
  public readonly targetId: string;
  /** 距离冷却期结束的剩余毫秒数 */
  public readonly remainingCooldownMs: number;
  /** 上一次触发熔断的原始错误信息 */
  public readonly lastError: string;
  /** 上一次建连失败的时间戳（毫秒） */
  public readonly failedAt: number;

  /**
   * 构造目标主机冷却期熔断异常
   *
   * @param targetId 目标主机唯一标识
   * @param remainingCooldownMs 剩余冷却时间（毫秒）
   * @param lastError 上一次失败原因
   * @param failedAt 上一次失败时间戳（毫秒）
   */
  public constructor(
    targetId: string,
    remainingCooldownMs: number,
    lastError: string,
    failedAt: number
  ) {
    const remainingSeconds = Math.ceil(remainingCooldownMs / 1000);
    super(
      `目标主机 "${targetId}" 处于熔断冷却期（剩余 ${remainingSeconds}s），已快速拦截建连请求以保护宿主机资源。上次失败原因: ${lastError}`
    );
    this.name = "HostInCooldownError";
    this.targetId = targetId;
    this.remainingCooldownMs = remainingCooldownMs;
    this.lastError = lastError;
    this.failedAt = failedAt;
    Object.setPrototypeOf(this, HostInCooldownError.prototype);
  }
}

/**
 * 熔断器记录的单台主机失败状态快照
 */
export interface CircuitBreakerFailureRecord {
  /** 目标主机唯一标识 */
  targetId: string;
  /** 失败发生时间戳（毫秒） */
  failedAt: number;
  /** 冷却期截止时间戳（毫秒） */
  cooldownUntil: number;
  /** 最近一次失败的错误描述 */
  lastError: string;
  /** 当前熔断状态：open（冷却拦截中）或 half_open（冷却期满待探活） */
  state: "open" | "half_open";
}

/**
 * 连接熔断器初始化选项
 */
export interface ConnectionCircuitBreakerOptions {
  /** 失败冷却期时长（毫秒），默认 60000ms */
  cooldownMs?: number;
  /** 可选的时间戳获取函数（便于确定性测试） */
  now?: () => number;
}

/**
 * SSH 连接防雪崩熔断状态机
 */
export class ConnectionCircuitBreaker {
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly failures = new Map<
    string,
    { failedAt: number; cooldownUntil: number; lastError: string }
  >();

  /**
   * 初始化连接熔断器实例
   *
   * @param options 熔断器配置选项
   */
  public constructor(options?: ConnectionCircuitBreakerOptions) {
    this.cooldownMs = options?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.now = options?.now ?? (() => Date.now());
  }

  /**
   * 校验指定目标主机是否允许发起建连请求
   *
   * 若处于冷却期内则直接抛出 HostInCooldownError；若冷却期已满则放行进入半开探活状态
   *
   * @param targetId 目标主机标识
   * @throws HostInCooldownError 当目标主机仍处于冷却期内时抛出
   */
  public assertCanConnect(targetId: string): void {
    const record = this.failures.get(targetId);
    if (!record) {
      return;
    }

    const currentTime = this.now();
    const remaining = record.cooldownUntil - currentTime;
    if (remaining > 0) {
      throw new HostInCooldownError(
        targetId,
        remaining,
        record.lastError,
        record.failedAt
      );
    }
  }

  /**
   * 记录目标主机建连失败并触发（或刷新）冷却期
   *
   * @param targetId 目标主机标识
   * @param error 触发熔断的错误对象或错误消息
   */
  public recordFailure(targetId: string, error: unknown): void {
    const currentTime = this.now();
    const lastError = error instanceof Error ? error.message : String(error);
    this.failures.set(targetId, {
      failedAt: currentTime,
      cooldownUntil: currentTime + this.cooldownMs,
      lastError,
    });
  }

  /**
   * 记录目标主机建连成功，清除其熔断状态并恢复闭合（Closed）
   *
   * @param targetId 目标主机标识
   */
  public recordSuccess(targetId: string): void {
    this.failures.delete(targetId);
  }

  /**
   * 查询指定目标主机的熔断状态记录
   *
   * @param targetId 目标主机标识
   * @return 熔断状态快照，若主机正常未熔断则返回 null
   */
  public getFailureRecord(targetId: string): CircuitBreakerFailureRecord | null {
    const record = this.failures.get(targetId);
    if (!record) {
      return null;
    }
    return this.toFailureRecord(targetId, record, this.now());
  }

  /**
   * 列出当前所有存在熔断记录的目标主机列表
   *
   * @return 熔断主机状态快照列表（无匹配时返回空数组）
   */
  public listFailureRecords(): CircuitBreakerFailureRecord[] {
    const currentTime = this.now();
    const list: CircuitBreakerFailureRecord[] = [];
    for (const [targetId, record] of this.failures.entries()) {
      list.push(this.toFailureRecord(targetId, record, currentTime));
    }
    return list;
  }

  private toFailureRecord(
    targetId: string,
    record: { failedAt: number; cooldownUntil: number; lastError: string },
    currentTime: number
  ): CircuitBreakerFailureRecord {
    return {
      targetId,
      failedAt: record.failedAt,
      cooldownUntil: record.cooldownUntil,
      lastError: record.lastError,
      state: currentTime < record.cooldownUntil ? "open" : "half_open",
    };
  }
}
