/**
 * 远程 Linux 系统体检与环境巡检服务
 *
 * @author Ateng
 * @since 2026-10-14
 */

import type { ConnectionPool } from "../connection/pool.js";
import { ExecService } from "./exec-service.js";
import type { DiskUsage, SSHSystemInfoParams, SSHSystemInfoResult } from "../types/system.js";

/**
 * 系统体检服务选项
 */
export interface SystemServiceOptions {
  /** 底层多主机连接池实例 */
  connectionPool: ConnectionPool;
  /** 可选的命令执行服务实例 */
  execService?: ExecService;
}

/**
 * 远程环境巡检与无损体检探针核心服务
 */
export class SystemService {
  private connectionPool: ConnectionPool;
  private execService: ExecService;

  public constructor(options: SystemServiceOptions) {
    this.connectionPool = options.connectionPool;
    this.execService =
      options.execService ??
      new ExecService({
        connectionPool: options.connectionPool,
      });
  }

  /**
   * 采集远程主机硬件规格、系统负载、内存磁盘及网络端口状态
   *
   * @param params 查询参数
   * @return 结构化的系统体检分析报告
   */
  public async getSystemInfo(params: SSHSystemInfoParams): Promise<SSHSystemInfoResult> {
    const probeScript = [
      'echo "===OS==="',
      "cat /etc/os-release 2>/dev/null || uname -s",
      'echo "===UNAME==="',
      "uname -r",
      "uname -m",
      "hostname 2>/dev/null || echo 'localhost'",
      'echo "===UPTIME==="',
      "cat /proc/uptime 2>/dev/null || uptime",
      'echo "===CPU==="',
      "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo 2>/dev/null || echo 1",
      "grep -m1 'model name' /proc/cpuinfo 2>/dev/null | cut -d: -f2 || echo 'Generic CPU'",
      "cat /proc/loadavg 2>/dev/null || echo '0.00 0.00 0.00'",
      'echo "===MEM==="',
      "grep -E '^(MemTotal|MemFree|MemAvailable):' /proc/meminfo 2>/dev/null",
      'echo "===DF==="',
      "df -k -P 2>/dev/null | grep -E '^/'",
      'echo "===PORTS==="',
      "ss -tlnH 2>/dev/null || netstat -tln 2>/dev/null || echo ''",
    ].join(" && ");

    const result = await this.execService.execute({
      command: probeScript,
      connectionId: params.connectionId,
      timeoutMs: 15000,
      dryRun: false,
      rawExec: false,
      dangerouslySkipSafetyCheck: false,
    });

    return this.parseProbeOutput(result.stdout);
  }

  /**
   * 解析探针执行输出并提取强类型结构
   */
  private parseProbeOutput(stdout: string): SSHSystemInfoResult {
    const sections: Record<string, string[]> = {};
    let currentSection = "DEFAULT";

    for (const line of stdout.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("===") && trimmed.endsWith("===")) {
        currentSection = trimmed.replace(/=/g, "").trim();
        sections[currentSection] = [];
      } else if (trimmed) {
        if (!sections[currentSection]) {
          sections[currentSection] = [];
        }
        sections[currentSection].push(trimmed);
      }
    }

    // 1. 解析 OS 与发行版
    const osLines = sections.OS ?? [];
    let distribution = "Linux";
    for (const osLine of osLines) {
      if (osLine.startsWith("PRETTY_NAME=")) {
        distribution = osLine.replace(/^PRETTY_NAME=/, "").replace(/["']/g, "");
        break;
      }
    }

    // 2. 解析内核、架构、主机名
    const unameLines = sections.UNAME ?? [];
    const kernel = unameLines[0] ?? "unknown-kernel";
    const arch = unameLines[1] ?? "unknown-arch";
    const hostname = unameLines[2] ?? "localhost";

    // 3. 解析运行时间
    const uptimeLines = sections.UPTIME ?? [];
    let uptime = "unknown";
    if (uptimeLines.length > 0) {
      const first = uptimeLines[0];
      const matchSeconds = first.match(/^([\d.]+)/);
      if (matchSeconds) {
        const totalSec = Math.floor(Number.parseFloat(matchSeconds[1]));
        const days = Math.floor(totalSec / 86400);
        const hours = Math.floor((totalSec % 86400) / 3600);
        const mins = Math.floor((totalSec % 3600) / 60);
        uptime = `${days}d ${hours}h ${mins}m`;
      } else {
        uptime = first;
      }
    }

    // 4. 解析 CPU
    const cpuLines = sections.CPU ?? [];
    const cores = Number.parseInt(cpuLines[0] ?? "1", 10) || 1;
    const model = (cpuLines[1] ?? "Generic CPU").trim();
    const loadStr = cpuLines[2] ?? "0 0 0";
    const loadParts = loadStr.split(/\s+/).slice(0, 3).map((v) => Number.parseFloat(v) || 0);

    // 5. 解析内存
    const memLines = sections.MEM ?? [];
    let memTotalKB = 0;
    let memAvailKB = 0;
    for (const memLine of memLines) {
      const parts = memLine.split(":");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const kb = Number.parseInt(parts[1].trim().split(/\s+/)[0], 10) || 0;
        if (key === "MemTotal") memTotalKB = kb;
        if (key === "MemAvailable" || (key === "MemFree" && memAvailKB === 0)) memAvailKB = kb;
      }
    }
    const totalMB = Math.round(memTotalKB / 1024);
    const freeMB = Math.round(memAvailKB / 1024);
    const usedMB = Math.max(0, totalMB - freeMB);
    const usagePercent = totalMB > 0 ? Number.parseFloat(((usedMB / totalMB) * 100).toFixed(1)) : 0;

    // 6. 解析磁盘挂载
    const dfLines = sections.DF ?? [];
    const disks: DiskUsage[] = [];
    for (const dfLine of dfLines) {
      const cols = dfLine.split(/\s+/);
      if (cols.length >= 6) {
        const totalKB = Number.parseInt(cols[1], 10) || 0;
        const usedKB = Number.parseInt(cols[2], 10) || 0;
        const freeKB = Number.parseInt(cols[3], 10) || 0;
        disks.push({
          filesystem: cols[0],
          totalGB: Number.parseFloat((totalKB / 1024 / 1024).toFixed(1)),
          usedGB: Number.parseFloat((usedKB / 1024 / 1024).toFixed(1)),
          freeGB: Number.parseFloat((freeKB / 1024 / 1024).toFixed(1)),
          usagePercent: cols[4],
          mount: cols[5],
        });
      }
    }

    // 7. 解析监听端口
    const portLines = sections.PORTS ?? [];
    const portSet = new Set<number>();
    for (const portLine of portLines) {
      const match = portLine.match(/:(\d+)\b/);
      if (match) {
        const port = Number.parseInt(match[1], 10);
        if (port > 0 && port <= 65535) {
          portSet.add(port);
        }
      }
    }
    const listeningPorts = Array.from(portSet).sort((a, b) => a - b);

    return {
      os: {
        distribution,
        kernel,
        arch,
        hostname,
      },
      uptime,
      cpu: {
        cores,
        model,
        loadAverage: loadParts,
      },
      memory: {
        totalMB,
        usedMB,
        freeMB,
        usagePercent,
      },
      disks,
      listeningPorts,
    };
  }
}
