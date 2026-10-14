/**
 * 远程 Linux 系统体检与环境巡检数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { z } from "zod";

/**
 * 获取远程系统体检信息入参 Schema
 */
export const SSHSystemInfoParamsSchema = z.object({
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SSHSystemInfoParams = z.infer<typeof SSHSystemInfoParamsSchema>;

/**
 * 磁盘挂载点使用情况模型
 */
export const DiskUsageSchema = z.object({
  mount: z.string().describe("挂载点路径"),
  filesystem: z.string().describe("文件系统名称"),
  totalGB: z.number().describe("总容量（GB）"),
  usedGB: z.number().describe("已用容量（GB）"),
  freeGB: z.number().describe("剩余可用容量（GB）"),
  usagePercent: z.string().describe("使用率百分比字符串（如 45%）"),
});

export type DiskUsage = z.infer<typeof DiskUsageSchema>;

/**
 * 远程系统体检巡检汇总结果 Schema
 */
export const SSHSystemInfoResultSchema = z.object({
  os: z.object({
    distribution: z.string().describe("Linux 发行版与版本（例如 Ubuntu 22.04 LTS）"),
    kernel: z.string().describe("内核版本号"),
    arch: z.string().describe("CPU 硬件架构（如 x86_64、aarch64）"),
    hostname: z.string().describe("主机名"),
  }),
  uptime: z.string().describe("系统连续运行时间"),
  cpu: z.object({
    cores: z.number().describe("CPU 核心数"),
    model: z.string().describe("CPU 型号名称"),
    loadAverage: z.array(z.number()).describe("1/5/15 分钟系统平均负载"),
  }),
  memory: z.object({
    totalMB: z.number().describe("物理总内存（MB）"),
    usedMB: z.number().describe("已使用内存（MB）"),
    freeMB: z.number().describe("剩余可用内存（MB）"),
    usagePercent: z.number().describe("内存使用百分比"),
  }),
  disks: z.array(DiskUsageSchema).describe("各主要磁盘分区与挂载点使用情况"),
  listeningPorts: z.array(z.number()).describe("当前系统正在监听的 TCP 端口列表"),
});

export type SSHSystemInfoResult = z.infer<typeof SSHSystemInfoResultSchema>;
