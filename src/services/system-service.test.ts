/**
 * 远程系统体检巡检服务单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it, vi } from "vitest";
import { SystemService } from "./system-service.js";
import type { ConnectionPool } from "../connection/pool.js";
import type { ExecService } from "./exec-service.js";

describe("SystemService 远程系统巡检探针", () => {
  it("应成功解析标准 Linux 探针多段输出并结构化呈现", async () => {
    const mockOutput = `
===OS===
NAME="Ubuntu"
VERSION="22.04.3 LTS (Jammy Jellyfish)"
ID=ubuntu
PRETTY_NAME="Ubuntu 22.04.3 LTS"
===UNAME===
5.15.0-88-generic
x86_64
prod-server-01
===UPTIME===
1234567.89 2345678.90
===CPU===
8
AMD EPYC 7763 64-Core Processor
0.15 0.22 0.18 1/850 12345
===MEM===
MemTotal:       16384000 kB
MemFree:         4096000 kB
MemAvailable:    8192000 kB
===DF===
/dev/root 104857600 47185920 57671680 45% /
/dev/sda1  52428800 10485760 41943040 20% /data
===PORTS===
LISTEN 0 128 0.0.0.0:22 0.0.0.0:*
LISTEN 0 511 127.0.0.1:3306 0.0.0.0:*
LISTEN 0 128 *:80 *:*
`;

    const mockExecService = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: mockOutput,
        stderr: "",
        executionTimeMs: 120,
        isTruncated: false,
        totalBytes: mockOutput.length,
      }),
    } as unknown as ExecService;

    const mockPool = {} as ConnectionPool;
    const systemService = new SystemService({
      connectionPool: mockPool,
      execService: mockExecService,
    });

    const info = await systemService.getSystemInfo({});

    expect(info.os.distribution).toBe("Ubuntu 22.04.3 LTS");
    expect(info.os.kernel).toBe("5.15.0-88-generic");
    expect(info.os.arch).toBe("x86_64");
    expect(info.os.hostname).toBe("prod-server-01");
    expect(info.cpu.cores).toBe(8);
    expect(info.cpu.model).toBe("AMD EPYC 7763 64-Core Processor");
    expect(info.cpu.loadAverage).toEqual([0.15, 0.22, 0.18]);
    expect(info.memory.totalMB).toBe(16000);
    expect(info.memory.freeMB).toBe(8000);
    expect(info.memory.usedMB).toBe(8000);
    expect(info.memory.usagePercent).toBe(50.0);
    expect(info.disks.length).toBe(2);
    expect(info.disks[0].mount).toBe("/");
    expect(info.disks[1].mount).toBe("/data");
    expect(info.listeningPorts).toEqual([22, 80, 3306]);
  });
});
