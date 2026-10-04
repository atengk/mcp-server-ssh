/**
 * 远程无状态命令执行服务
 *
 * @author Ateng
 * @since 2026-10-03
 */

import type { ClientChannel, ExecOptions } from "ssh2";
import type { ConnectionPool } from "../connection/manager.js";
import { SafetyGuard } from "../security/guard.js";
import { OutputTruncator } from "../security/truncator.js";
import type { SSHExecParams, SSHExecResult } from "../types/exec.js";

/**
 * 命令执行服务配置选项
 */
export interface ExecServiceOptions {
  connectionPool: ConnectionPool;
  safetyGuard?: SafetyGuard;
  outputTruncator?: OutputTruncator;
}

/**
 * 远程命令执行核心服务
 */
export class ExecService {
  private connectionPool: ConnectionPool;
  private safetyGuard: SafetyGuard;
  private outputTruncator: OutputTruncator;

  public constructor(options: ExecServiceOptions) {
    this.connectionPool = options.connectionPool;
    this.safetyGuard = options.safetyGuard ?? new SafetyGuard();
    this.outputTruncator = options.outputTruncator ?? new OutputTruncator();
  }

  /**
   * 执行无状态远程 Bash 命令
   *
   * @param params 命令执行入参
   * @return 命令执行退出码、耗时与截断净化后的输出结果
   * @throws 触发高危拦截规则、连接缺失或超时中断时抛出异常
   */
  public async execute(params: SSHExecParams): Promise<SSHExecResult> {
    const startTime = Date.now();

    // 1. 前置安全守卫校验（支持环境变量 + 入参双重授权逃生门）
    if (params.dangerouslySkipSafetyCheck) {
      const allowDangerous =
        process.env.MCP_SSH_ALLOW_DANGEROUS_COMMANDS === "true" ||
        process.env.SSH_ALLOW_DANGEROUS_COMMANDS === "true";
      if (!allowDangerous) {
        throw new Error(
          "拒绝执行危险命令：检测到 dangerouslySkipSafetyCheck 请求，但服务端未配置环境变量 MCP_SSH_ALLOW_DANGEROUS_COMMANDS=true 授权放行"
        );
      }
    } else {
      this.safetyGuard.assertSafe(params.command);
    }

    // 2. 若仅为试运行检测 (dryRun)，放行并直接返回测试标记
    if (params.dryRun) {
      return {
        exitCode: 0,
        stdout: `[dryRun] 命令已通过安全规则检测，未真正下发执行: ${params.command}`,
        stderr: "",
        executionTimeMs: Date.now() - startTime,
        isTruncated: false,
        totalBytes: 0,
      };
    }

    // 3. 获取目标或默认活跃物理连接
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      const lastErr = this.connectionPool.getLastConnectionError();
      const detail = lastErr ? `。最近一次尝试建连失败原因: ${lastErr}` : "";
      throw new Error(
        `未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})${detail}，请先通过 ssh_connect 建立连接`
      );
    }

    // 4. 组装最终执行命令：初始目录 + 登录 Shell 包装
    let wrappedCmd = params.command;
    if (params.cwd) {
      const escapedCwd = params.cwd.replace(/'/g, "'\\''");
      wrappedCmd = `cd '${escapedCwd}' && ${wrappedCmd}`;
    }

    let finalCommand = wrappedCmd;
    if (!params.rawExec) {
      const escapedCmd = wrappedCmd.replace(/'/g, "'\\''");
      finalCommand = `bash -l -c '${escapedCmd}'`;
    }

    const execOptions: ExecOptions = {};
    if (params.env) {
      execOptions.env = params.env;
    }

    // 5. 下发执行并收集流数据
    const timeoutMs = params.timeoutMs || 60000;

    return new Promise<SSHExecResult>((resolve, reject) => {
      let isSettled = false;
      let timer: NodeJS.Timeout | undefined;

      conn.client.exec(finalCommand, execOptions, (err, stream: ClientChannel) => {
        if (err) {
          return reject(new Error(`远程命令通道创建失败: ${err.message}`));
        }

        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        // 设置执行超时熔断计时器
        timer = setTimeout(() => {
          if (!isSettled) {
            isSettled = true;
            try {
              stream.close();
              if (typeof stream.signal === "function") {
                stream.signal("KILL");
              }
            } catch {}
            reject(
              new Error(
                `远程命令执行超时（设定限制为 ${timeoutMs}ms）。如需执行耗时较长的命令（如编译、打包、下载），请显式指定更长的 timeoutMs 参数，或使用 ssh_session_* 交互终端会话模式。`
              )
            );
          }
        }, timeoutMs);

        stream.stdout.on("data", (chunk: Buffer) => {
          stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        let exitCode: number | null = null;
        stream.on("exit", (code: number | null) => {
          exitCode = code;
        });

        stream.on("close", () => {
          if (!isSettled) {
            isSettled = true;
            if (timer) {
              clearTimeout(timer);
            }

            const rawStdout = Buffer.concat(stdoutChunks).toString("utf-8");
            const rawStderr = Buffer.concat(stderrChunks).toString("utf-8");

            // 6. 后置输出流净化与 64KB 截断处理
            const processedStdout = this.outputTruncator.process(rawStdout);
            const processedStderr = this.outputTruncator.process(rawStderr);

            resolve({
              exitCode: exitCode ?? 0,
              stdout: processedStdout.text,
              stderr: processedStderr.text,
              executionTimeMs: Date.now() - startTime,
              isTruncated: processedStdout.isTruncated || processedStderr.isTruncated,
              totalBytes: processedStdout.originalBytes + processedStderr.originalBytes,
            });
          }
        });

        stream.on("error", (streamErr: Error) => {
          if (!isSettled) {
            isSettled = true;
            if (timer) {
              clearTimeout(timer);
            }
            reject(new Error(`命令执行数据流异常: ${streamErr.message}`));
          }
        });
      });
    });
  }
}
