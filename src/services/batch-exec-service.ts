/**
 * 多主机批量命令执行与并发/串行调度引擎 (BatchExecService)
 *
 * 支持目标选择器展开、按需透明快速建连、熔断冷却隔离、并发限流、串行遇错中断及单节点 16KB 紧凑输出截断保护
 *
 * @author Ateng
 * @since 2026-10-30
 */

import type { AuditService } from "../audit/index.js";
import { SSHConfigParser } from "../connection/config-parser.js";
import type { ConnectionPool } from "../connection/pool.js";
import { TargetResolver } from "../connection/target-resolver.js";
import { SafetyGuard } from "../security/guard.js";
import { OutputTruncator } from "../security/truncator.js";
import {
  SSHBatchExecParamsSchema,
  type SSHBatchExecInputParams,
  type SSHBatchExecParams,
  type SSHBatchExecResult,
  type SSHBatchNodeResult,
} from "../types/exec.js";
import { ExecService } from "./exec-service.js";

/**
 * 批量执行单节点紧凑输出上限：16KB (16384 字节)
 */
export const BATCH_NODE_MAX_BYTES = 16_384;

/**
 * 批量执行单节点头部保留：4KB (4096 字节)
 */
export const BATCH_NODE_HEAD_BYTES = 4_096;

/**
 * 批量执行单节点尾部保留：12KB (12288 字节)
 */
export const BATCH_NODE_TAIL_BYTES = 12_288;

/**
 * 批量命令执行服务初始化选项
 */
export interface BatchExecServiceOptions {
  /** 连接池管理器实例 */
  connectionPool: ConnectionPool;
  /** SSH 配置文件解析器实例 */
  configParser?: SSHConfigParser;
  /** 目标选择器解析器实例 */
  targetResolver?: TargetResolver;
  /** 安全拦截守卫实例 */
  safetyGuard?: SafetyGuard;
  /** 单节点输出截断器实例（默认 16KB 紧凑预算） */
  outputTruncator?: OutputTruncator;
  /** 是否允许开启跳过安全检查逃生门 */
  allowDangerousCommands?: boolean;
  /** 可选的安全审计服务实例 */
  auditService?: AuditService;
}

/**
 * 多主机批量命令执行协调服务
 */
export class BatchExecService {
  private readonly connectionPool: ConnectionPool;
  private readonly configParser: SSHConfigParser;
  private readonly targetResolver: TargetResolver;
  private readonly safetyGuard: SafetyGuard;
  private readonly nodeExecService: ExecService;
  private readonly allowDangerousCommands: boolean;
  private readonly auditService?: AuditService;

  /**
   * 构造批量命令执行服务实例
   *
   * @param options 依赖组件与配置选项
   */
  public constructor(options: BatchExecServiceOptions) {
    this.connectionPool = options.connectionPool;
    this.configParser = options.configParser ?? new SSHConfigParser();
    this.targetResolver =
      options.targetResolver ??
      new TargetResolver({
        connectionPool: this.connectionPool,
        configParser: this.configParser,
      });
    this.safetyGuard = options.safetyGuard ?? new SafetyGuard();
    this.allowDangerousCommands = options.allowDangerousCommands ?? false;
    this.auditService = options.auditService;

    const compactTruncator =
      options.outputTruncator ??
      new OutputTruncator({
        maxBytes: BATCH_NODE_MAX_BYTES,
        headBytes: BATCH_NODE_HEAD_BYTES,
        tailBytes: BATCH_NODE_TAIL_BYTES,
      });

    this.nodeExecService = new ExecService({
      connectionPool: this.connectionPool,
      safetyGuard: this.safetyGuard,
      outputTruncator: compactTruncator,
      allowDangerousCommands: this.allowDangerousCommands,
      auditService: this.auditService,
    });
  }

  /**
   * 向目标主机集群批量下发执行命令
   *
   * @param rawParams 批量执行入参
   * @return 聚合统计与各节点独立执行结果映射
   * @throws 当触发前置高危命令安全拦截规则或无有效目标时抛出异常
   */
  public async executeBatch(rawParams: SSHBatchExecInputParams): Promise<SSHBatchExecResult> {
    const params: SSHBatchExecParams = SSHBatchExecParamsSchema.parse(rawParams);
    const batchStartTime = Date.now();

    // 1. 统一执行前置 SafetyGuard 安全规则校验与审计记录
    this.nodeExecService.validateCommandSafety(
      params.command,
      params.dangerouslySkipSafetyCheck
    );

    // 2. 解析并展开目标选择器（支持 @all_active、@all_configured、通配符与显式别名）
    const resolvedTargets = this.targetResolver.resolve(params.targets);
    if (resolvedTargets.length === 0) {
      throw new Error(
        `批量执行目标解析为空：输入的选择器 [${params.targets.join(", ")}] 未匹配到任何活跃连接或预设主机别名`
      );
    }

    const results: Record<string, SSHBatchNodeResult> = {};

    // 3. 若为 dryRun 预检模式，直接生成全节点通过报告而不触发远程建连与执行
    if (params.dryRun) {
      for (const target of resolvedTargets) {
        results[target] = {
          target,
          status: "success",
          exitCode: 0,
          stdout: `[dryRun] 命令已通过安全规则检测，未真正下发执行: ${params.command}`,
          stderr: "",
          executionTimeMs: 0,
          isTruncated: false,
          totalBytes: 0,
        };
      }
      return {
        command: params.command,
        mode: params.mode,
        dryRun: true,
        totalTargets: resolvedTargets.length,
        succeeded: resolvedTargets.length,
        failed: 0,
        skipped: 0,
        executionTimeMs: Date.now() - batchStartTime,
        results,
      };
    }

    // 4. 根据调度模式分发执行（parallel 受控并发 / serial 顺序串行）
    if (params.mode === "serial") {
      await this.runSerial(resolvedTargets, params, results);
    } else {
      await this.runParallel(resolvedTargets, params, results);
    }

    // 5. 汇总成功、失败与跳过统计
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    for (const target of resolvedTargets) {
      const nodeResult = results[target];
      if (!nodeResult || nodeResult.status === "skipped") {
        skipped++;
      } else if (nodeResult.status === "success") {
        succeeded++;
      } else {
        failed++;
      }
    }

    return {
      command: params.command,
      mode: params.mode,
      dryRun: false,
      totalTargets: resolvedTargets.length,
      succeeded,
      failed,
      skipped,
      executionTimeMs: Date.now() - batchStartTime,
      results,
    };
  }

  /**
   * 顺序串行执行模式（支持 stopOnError 遇错立即终止后续节点并标记为 skipped）
   */
  private async runSerial(
    targets: string[],
    params: SSHBatchExecParams,
    results: Record<string, SSHBatchNodeResult>
  ): Promise<void> {
    let halted = false;

    for (const target of targets) {
      if (halted) {
        results[target] = {
          target,
          status: "skipped",
          exitCode: null,
          stdout: "",
          stderr: "",
          executionTimeMs: 0,
          isTruncated: false,
          totalBytes: 0,
        };
        continue;
      }

      const nodeResult = await this.executeOnSingleTarget(target, params);
      results[target] = nodeResult;

      if (params.stopOnError && nodeResult.status === "failed") {
        halted = true;
      }
    }
  }

  /**
   * 受控并发执行模式（并发数严格受 concurrency 参数限制）
   */
  private async runParallel(
    targets: string[],
    params: SSHBatchExecParams,
    results: Record<string, SSHBatchNodeResult>
  ): Promise<void> {
    const concurrencyLimit = Math.max(1, Math.min(20, params.concurrency));
    let cursor = 0;

    const worker = async (): Promise<void> => {
      while (cursor < targets.length) {
        const index = cursor++;
        const target = targets[index];
        results[target] = await this.executeOnSingleTarget(target, params);
      }
    };

    const workerCount = Math.min(concurrencyLimit, targets.length);
    const workers: Promise<void>[] = [];
    for (let i = 0; i < workerCount; i++) {
      workers.push(worker());
    }

    await Promise.all(workers);
  }

  /**
   * 在单台目标主机上执行命令（若尚未建立连接则自动触发按需建连与熔断保护）
   */
  private async executeOnSingleTarget(
    target: string,
    params: SSHBatchExecParams
  ): Promise<SSHBatchNodeResult> {
    const nodeStart = Date.now();

    try {
      // 1. 确保目标连接已就绪（未连接时自动触发按需快速建连）
      const connectionId = await this.ensureTargetConnected(target);

      // 2. 通过配置了 16KB 紧凑截断器的 ExecService 执行命令
      const execResult = await this.nodeExecService.execute({
        connectionId,
        command: params.command,
        cwd: params.cwd,
        env: params.env,
        timeoutMs: params.timeoutMs,
        rawExec: params.rawExec,
        sudo: params.sudo,
        sudoPassword: params.sudoPassword,
        dryRun: false,
        dangerouslySkipSafetyCheck: params.dangerouslySkipSafetyCheck,
      });

      const isSuccess = execResult.exitCode === 0;
      return {
        target,
        status: isSuccess ? "success" : "failed",
        exitCode: execResult.exitCode,
        stdout: execResult.stdout,
        stderr: execResult.stderr,
        executionTimeMs: execResult.executionTimeMs,
        isTruncated: execResult.isTruncated,
        totalBytes: execResult.totalBytes,
        ...(isSuccess
          ? {}
          : { error: `命令退出码非零 (${execResult.exitCode})` }),
      };
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      return {
        target,
        status: "failed",
        exitCode: null,
        stdout: "",
        stderr: errMessage,
        executionTimeMs: Date.now() - nodeStart,
        isTruncated: false,
        totalBytes: 0,
        error: errMessage,
      };
    }
  }

  /**
   * 检查目标是否已存在活跃连接，若未连接则自动发起按需建连
   */
  private async ensureTargetConnected(target: string): Promise<string> {
    const existing = this.connectionPool.getConnection(target);
    if (existing && existing.id === target) {
      return existing.id;
    }

    const activeByAliasOrHost = this.connectionPool
      .listConnections()
      .find((conn) => conn.connectionId === target || conn.host === target);
    if (activeByAliasOrHost) {
      return activeByAliasOrHost.connectionId;
    }

    const aliasConfig = this.configParser.resolveHost(target);
    if (aliasConfig) {
      const info = await this.connectionPool.connect({
        sshConfigAlias: target,
        connectionId: target,
        setAsDefault: false,
      });
      return info.connectionId;
    }

    // 支持直接传入 host 或 host:port 进行按需建连
    let host = target;
    let port: number | undefined;
    if (target.includes(":")) {
      const parts = target.split(":");
      host = parts[0];
      const parsedPort = Number.parseInt(parts[1], 10);
      if (!Number.isNaN(parsedPort)) {
        port = parsedPort;
      }
    }

    const info = await this.connectionPool.connect({
      host,
      port,
      connectionId: target,
      setAsDefault: false,
    });
    return info.connectionId;
  }
}
