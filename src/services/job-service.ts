/**
 * 受管脱机后台作业服务实现
 *
 * @author Ateng
 * @since 2026-10-14
 */

import type { ExecService } from "./exec-service.js";
import type {
  SSHJobCleanParams,
  SSHJobCleanResult,
  SSHJobKillParams,
  SSHJobKillResult,
  SSHJobLogsParams,
  SSHJobLogsResult,
  SSHJobStartParams,
  SSHJobStartResult,
  SSHJobStatusParams,
  SSHJobStatusResult,
} from "../types/job.js";

/**
 * JobService 构造依赖选项
 */
export interface JobServiceOptions {
  execService: ExecService;
}

/**
 * 远程脱机后台作业服务
 */
export class JobService {
  private readonly execService: ExecService;

  constructor(options: JobServiceOptions) {
    this.execService = options.execService;
  }

  /**
   * 提交并在远程主机后台脱机启动长耗时命令
   *
   * @param params 作业启动入参
   * @return 作业标识与启动结果
   */
  public async startJob(params: SSHJobStartParams): Promise<SSHJobStartResult> {
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const jobDir = `~/.mcp_jobs/${jobId}`;

    const cdCmd = params.cwd ? `cd '${params.cwd.replace(/'/g, "'\\''")}'` : 'cd "$HOME"';
    const envExports = params.env
      ? Object.entries(params.env)
          .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
          .join("\n")
      : "";

    const scriptContent = `#!/usr/bin/env bash
${cdCmd}
${envExports}
${params.command}
EXIT_CODE=$?
echo $EXIT_CODE > "$HOME/.mcp_jobs/${jobId}/exit_code"
exit $EXIT_CODE
`;

    const b64Script = Buffer.from(scriptContent, "utf-8").toString("base64");
    const b64Cmd = Buffer.from(params.command, "utf-8").toString("base64");

    const launchCmd = `mkdir -p ~/.mcp_jobs/${jobId} && \
echo '${b64Script}' | base64 -d > ~/.mcp_jobs/${jobId}/run.sh && \
chmod +x ~/.mcp_jobs/${jobId}/run.sh && \
echo '${b64Cmd}' | base64 -d > ~/.mcp_jobs/${jobId}/command.txt && \
nohup bash ~/.mcp_jobs/${jobId}/run.sh > ~/.mcp_jobs/${jobId}/stdout.log 2>&1 & echo $! > ~/.mcp_jobs/${jobId}/pid && cat ~/.mcp_jobs/${jobId}/pid`;

    const result = await this.execService.execute({
      command: launchCmd,
      connectionId: params.connectionId,
      rawExec: true,
    });

    const pid = parseInt(result.stdout.trim(), 10) || 0;

    return {
      jobId,
      pid,
      jobDir,
    };
  }

  /**
   * 查询指定脱机作业的存活状态与退出状态码
   *
   * @param params 状态查询入参
   * @return 作业状态与退出码
   */
  public async getJobStatus(params: SSHJobStatusParams): Promise<SSHJobStatusResult> {
    const probeCmd = `DIR="$HOME/.mcp_jobs/${params.jobId}"
if [ ! -d "$DIR" ]; then
  echo "NOT_FOUND"
  exit 0
fi
PID=$(cat "$DIR/pid" 2>/dev/null || true)
CMD=$(cat "$DIR/command.txt" 2>/dev/null || true)
KILLED=$(cat "$DIR/.killed" 2>/dev/null || true)
if [ -f "$DIR/exit_code" ]; then
  EXIT=$(cat "$DIR/exit_code" 2>/dev/null || echo "1")
  echo "EXIT:$PID:$EXIT:$KILLED"
elif [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
  echo "RUNNING:$PID"
else
  echo "LOST:$PID:$KILLED"
fi
echo "COMMAND:$CMD"`;

    const result = await this.execService.execute({
      command: probeCmd,
      connectionId: params.connectionId,
      rawExec: true,
    });

    const lines = result.stdout.trim().split("\n");
    let statusText = "unknown";
    let pid = 0;
    let exitCode: number | null = null;
    let command = "";

    for (const line of lines) {
      if (line.startsWith("RUNNING:")) {
        statusText = "running";
        pid = parseInt(line.split(":")[1], 10) || 0;
      } else if (line.startsWith("EXIT:")) {
        const parts = line.split(":");
        pid = parseInt(parts[1], 10) || 0;
        const code = parseInt(parts[2], 10);
        const wasKilled = parts[3] === "1";
        exitCode = isNaN(code) ? 1 : code;
        if (wasKilled || exitCode === 137 || exitCode === 143) {
          statusText = "killed";
        } else {
          statusText = exitCode === 0 ? "completed" : "failed";
        }
      } else if (line.startsWith("LOST:")) {
        const parts = line.split(":");
        pid = parseInt(parts[1], 10) || 0;
        const wasKilled = parts[2] === "1";
        statusText = wasKilled ? "killed" : "failed";
      } else if (line.startsWith("COMMAND:")) {
        command = line.slice("COMMAND:".length);
      }
    }

    return {
      jobId: params.jobId,
      status: statusText as any,
      pid,
      exitCode,
      command,
    };
  }

  /**
   * 分段获取脱机作业日志输出
   *
   * @param params 日志读取入参
   * @return 分页日志行与总数
   */
  public async getJobLogs(params: SSHJobLogsParams): Promise<SSHJobLogsResult> {
    const startLine = params.offsetLines + 1;
    const endLine = params.offsetLines + params.maxLines;

    const readCmd = `LOG_FILE="$HOME/.mcp_jobs/${params.jobId}/stdout.log"
if [ ! -f "$LOG_FILE" ]; then
  echo "TOTAL:0"
  echo "---LOGS---"
  exit 0
fi
TOTAL=$(wc -l < "$LOG_FILE" | tr -d ' ')
echo "TOTAL:$TOTAL"
echo "---LOGS---"
sed -n '${startLine},${endLine}p' "$LOG_FILE"`;

    const result = await this.execService.execute({
      command: readCmd,
      connectionId: params.connectionId,
      rawExec: true,
    });

    const fullOutput = result.stdout;
    const separator = "---LOGS---\n";
    const sepIndex = fullOutput.indexOf(separator);

    let totalLines = 0;
    let logContent = "";

    if (sepIndex >= 0) {
      const header = fullOutput.slice(0, sepIndex);
      const totalMatch = header.match(/TOTAL:(\d+)/);
      if (totalMatch) {
        totalLines = parseInt(totalMatch[1], 10) || 0;
      }
      logContent = fullOutput.slice(sepIndex + separator.length);
    } else {
      logContent = fullOutput;
    }

    const lines = logContent
      ? logContent.split(/\r?\n/).filter((line, idx, arr) => idx < arr.length - 1 || line !== "")
      : [];

    const hasMore = params.offsetLines + lines.length < totalLines;

    return {
      jobId: params.jobId,
      lines,
      totalLines,
      hasMore,
    };
  }

  /**
   * 向指定的脱机后台作业发送终止信号
   *
   * @param params 终止参数
   * @return 终止结果
   */
  public async killJob(params: SSHJobKillParams): Promise<SSHJobKillResult> {
    const sig = params.signal || "SIGTERM";
    const killCmd = `DIR="$HOME/.mcp_jobs/${params.jobId}"
PID=$(cat "$DIR/pid" 2>/dev/null || true)
if [ -n "$PID" ] && kill -${sig} "$PID" 2>/dev/null; then
  echo "1" > "$DIR/.killed"
  echo "KILLED:$PID"
else
  echo "FAIL:$PID"
fi`;

    const result = await this.execService.execute({
      command: killCmd,
      connectionId: params.connectionId,
      rawExec: true,
    });

    const stdout = result.stdout.trim();
    const isKilled = stdout.includes("KILLED");
    const pidMatch = stdout.match(/(?:KILLED|FAIL):(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1], 10) || 0 : 0;

    return {
      jobId: params.jobId,
      killed: isKilled,
      pid,
    };
  }

  /**
   * 清理过期或指定作业的工作空间
   *
   * @param params 清理参数
   * @return 被清理的作业数量
   */
  public async cleanJobs(params: SSHJobCleanParams): Promise<SSHJobCleanResult> {
    let cleanCmd = "";
    if (params.jobId) {
      const status = await this.getJobStatus({
        jobId: params.jobId,
        connectionId: params.connectionId,
      });
      if (status.status === "running") {
        throw new Error(
          `无法清理正在运行中的脱机作业 [${params.jobId}] (PID: ${status.pid})，请先终止作业`
        );
      }
      cleanCmd = `rm -rf "$HOME/.mcp_jobs/${params.jobId}" && echo "CLEANED:1"`;
    } else {
      const days = params.maxAgeDays || 7;
      cleanCmd = `COUNT=$(find "$HOME/.mcp_jobs" -mindepth 1 -maxdepth 1 -type d -mtime +${days} 2>/dev/null | wc -l | tr -d ' ')
find "$HOME/.mcp_jobs" -mindepth 1 -maxdepth 1 -type d -mtime +${days} -exec rm -rf {} + 2>/dev/null
echo "CLEANED:$COUNT"`;
    }

    const result = await this.execService.execute({
      command: cleanCmd,
      connectionId: params.connectionId,
      rawExec: true,
    });

    const match = result.stdout.match(/CLEANED:(\d+)/);
    const cleanedCount = match ? parseInt(match[1], 10) || 0 : 0;

    return {
      cleanedCount,
    };
  }
}
