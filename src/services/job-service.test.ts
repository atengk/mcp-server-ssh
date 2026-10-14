/**
 * JobService 脱机后台作业服务单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it, vi } from "vitest";
import { JobService } from "./job-service.js";
import type { ExecService } from "./exec-service.js";

describe("JobService 脱机后台作业服务", () => {
  it("应成功创建脱机作业并返回 jobId 与远程 PID", async () => {
    let executedCmd = "";
    const mockExecService = {
      execute: vi.fn((params) => {
        executedCmd = params.command;
        return Promise.resolve({
          exitCode: 0,
          stdout: "12345\n", // 返回模拟的远程 pid
          stderr: "",
          executionTimeMs: 50,
          isTruncated: false,
          totalBytes: 6,
        });
      }),
    } as unknown as ExecService;

    const jobService = new JobService({
      execService: mockExecService,
    });

    const result = await jobService.startJob({
      command: "mvn clean package -DskipTests",
      cwd: "/home/user/project",
      env: { MAVEN_OPTS: "-Xmx2g" },
    });

    expect(result.jobId).toMatch(/^job_/);
    expect(result.pid).toBe(12345);
    expect(result.jobDir).toContain(result.jobId);
    expect(executedCmd).toContain("nohup bash");
    expect(executedCmd).toContain("base64 -d");
    const b64Match = executedCmd.match(/echo '([^']+)' \| base64 -d > ~\/[^\/]+\/[^\/]+\/run\.sh/);
    const decodedScript = Buffer.from(b64Match![1], "base64").toString("utf-8");
    expect(decodedScript).toContain("mvn clean package -DskipTests");
    expect(decodedScript).toContain("MAVEN_OPTS");
  });

  it("应正确查询运行中与已完成状态的作业", async () => {
    const mockExecService = {
      execute: vi
        .fn()
        // 第一次调用返回 RUNNING:12345
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "RUNNING:12345\nCOMMAND:make -j8\n",
          stderr: "",
          executionTimeMs: 20,
          isTruncated: false,
          totalBytes: 30,
        })
        // 第二次调用返回 EXIT:12345:0:
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "EXIT:12345:0:\nCOMMAND:make -j8\n",
          stderr: "",
          executionTimeMs: 20,
          isTruncated: false,
          totalBytes: 30,
        })
        // 第三次调用返回被信号强杀 EXIT:12345:137:
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "EXIT:12345:137:\nCOMMAND:make -j8\n",
          stderr: "",
          executionTimeMs: 20,
          isTruncated: false,
          totalBytes: 30,
        }),
    } as unknown as ExecService;

    const jobService = new JobService({
      execService: mockExecService,
    });

    const status1 = await jobService.getJobStatus({ jobId: "job_test_1" });
    expect(status1.status).toBe("running");
    expect(status1.pid).toBe(12345);
    expect(status1.exitCode).toBeNull();

    const status2 = await jobService.getJobStatus({ jobId: "job_test_1" });
    expect(status2.status).toBe("completed");
    expect(status2.exitCode).toBe(0);

    const status3 = await jobService.getJobStatus({ jobId: "job_test_1" });
    expect(status3.status).toBe("killed");
    expect(status3.exitCode).toBe(137);
  });

  it("应支持按行范围分段读取作业日志", async () => {
    const mockExecService = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "TOTAL:5\n---LOGS---\nline 2\nline 3\n",
        stderr: "",
        executionTimeMs: 15,
        isTruncated: false,
        totalBytes: 35,
      }),
    } as unknown as ExecService;

    const jobService = new JobService({
      execService: mockExecService,
    });

    const logsResult = await jobService.getJobLogs({
      jobId: "job_test_logs",
      offsetLines: 1,
      maxLines: 2,
    });

    expect(logsResult.jobId).toBe("job_test_logs");
    expect(logsResult.lines).toEqual(["line 2", "line 3"]);
    expect(logsResult.totalLines).toBe(5);
    expect(logsResult.hasMore).toBe(true);
  });

  it("应成功下发 kill 信号终止目标脱机作业", async () => {
    const mockExecService = {
      execute: vi.fn().mockResolvedValue({
        exitCode: 0,
        stdout: "KILLED:12345\n",
        stderr: "",
        executionTimeMs: 10,
        isTruncated: false,
        totalBytes: 13,
      }),
    } as unknown as ExecService;

    const jobService = new JobService({
      execService: mockExecService,
    });

    const killResult = await jobService.killJob({
      jobId: "job_test_kill",
      signal: "SIGKILL",
    });

    expect(killResult.killed).toBe(true);
    expect(killResult.pid).toBe(12345);
  });

  it("应支持清理指定已终止作业的工作空间并在作业运行中时拒绝清理", async () => {
    const mockExecService = {
      execute: vi
        .fn()
        // 第一次调用 getJobStatus 返回 running
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "RUNNING:12345\nCOMMAND:test\n",
          stderr: "",
          executionTimeMs: 10,
          isTruncated: false,
          totalBytes: 25,
        })
        // 第二次调用 getJobStatus 返回 completed
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "EXIT:12345:0:\nCOMMAND:test\n",
          stderr: "",
          executionTimeMs: 10,
          isTruncated: false,
          totalBytes: 25,
        })
        // 第三次调用 cleanCmd
        .mockResolvedValueOnce({
          exitCode: 0,
          stdout: "CLEANED:1\n",
          stderr: "",
          executionTimeMs: 10,
          isTruncated: false,
          totalBytes: 10,
        }),
    } as unknown as ExecService;

    const jobService = new JobService({
      execService: mockExecService,
    });

    // 运行中作业清理应被拦截
    await expect(jobService.cleanJobs({ jobId: "job_running" })).rejects.toThrow(
      /无法清理正在运行中的脱机作业/
    );

    // 已终止作业正常清理
    const cleanResult = await jobService.cleanJobs({
      jobId: "job_test_clean",
    });

    expect(cleanResult.cleanedCount).toBe(1);
  });
});
