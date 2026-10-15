/**
 * CLI 自检诊断套件测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it, vi } from "vitest";
import { runDoctor } from "./doctor.js";
import type { ConnectionPool } from "../connection/pool.js";

describe("CLI 全景自检排障套件 (runDoctor)", () => {
  it("默认环境下应全量检测 Runtime、本地密钥与合规配置并成功返回", async () => {
    const result = await runDoctor({ env: {} });

    expect(result.success).toBe(true);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.output).toContain("mcp-server-ssh 全景自检排障套件");
    expect(result.output).toContain("[Runtime 运行时]");
    expect(result.output).toContain("[本地 OpenSSH 资产]");
    expect(result.output).toContain("[环境变量配置]");
    expect(result.output).toContain("[目标主机连通性]");

    const auditCheck = result.checks.find((c) => c.name === "安全审计轨迹 (ADR-0014)");
    expect(auditCheck?.status).toBe("PASS");
    expect(auditCheck?.message).toContain("未启用状态");

    const identityCheck = result.checks.find((c) => c.name === "服务身份标识 (ADR-0015)");
    expect(identityCheck?.status).toBe("PASS");
    expect(identityCheck?.message).toContain('"mcp-server-ssh"');
    expect(identityCheck?.message).toContain("未配置额外引导指示");
  });

  it("当配置了自定义服务身份与引导指示时，诊断应展示对应名称与指示字符长度", async () => {
    const result = await runDoctor({
      env: {
        MCP_SSH_SERVER_NAME: "prod-cluster-gateway",
        MCP_SSH_SERVER_INSTRUCTIONS: "专用于生产集群巡检与运维操作",
      },
    });

    const identityCheck = result.checks.find((c) => c.name === "服务身份标识 (ADR-0015)");
    expect(identityCheck?.status).toBe("PASS");
    expect(identityCheck?.message).toContain('"prod-cluster-gateway"');
    expect(identityCheck?.message).toContain("已注入自定义引导指示");
  });

  it("当配置了审计日志路径且目录可写时，审计探针应报告 PASS", async () => {
    const result = await runDoctor({
      env: {
        MCP_SSH_AUDIT_LOG_PATH: "./test-audit.log",
      },
    });

    const auditCheck = result.checks.find((c) => c.name === "安全审计轨迹 (ADR-0014)");
    expect(auditCheck?.status).toBe("PASS");
    expect(auditCheck?.message).toContain("安全审计已激活");
  });


  it("当环境变量存在非法配置时，诊断应标记 FAIL 并判定不通过", async () => {
    const badEnv = {
      MCP_SSH_PORT: "not-a-port",
    };

    const result = await runDoctor({ env: badEnv });

    expect(result.success).toBe(false);
    const configCheck = result.checks.find((c) => c.name === "规范配置解析 (ADR-0012)");
    expect(configCheck?.status).toBe("FAIL");
    expect(result.output).toContain("[FAIL]");
  });

  it("当配置了目标主机且 SSH 连接成功时，连通性应标记 PASS", async () => {
    const mockPool = {
      connect: vi.fn().mockResolvedValue({
        connectionId: "conn_mock_1",
        host: "127.0.0.1",
        port: 22,
        username: "testuser",
        connectedAt: new Date(),
        lastActiveAt: new Date(),
      }),
      disconnect: vi.fn().mockResolvedValue(true),
    } as unknown as ConnectionPool;

    const envWithTarget = {
      MCP_SSH_HOST: "127.0.0.1",
      MCP_SSH_PORT: "22",
      MCP_SSH_USER: "testuser",
    };

    const result = await runDoctor({
      env: envWithTarget,
      connectionPool: mockPool,
      probeTimeoutMs: 1000,
    });

    const sshCheck = result.checks.find((c) => c.name === "SSH 握手与鉴权");
    expect(sshCheck?.status).toBe("PASS");
    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockPool.disconnect).toHaveBeenCalledWith("conn_mock_1");
  });

  it("当目标主机 SSH 鉴权失败时，连通性应标记 FAIL", async () => {
    const mockPool = {
      connect: vi.fn().mockRejectedValue(new Error("All configured authentication methods failed")),
      disconnect: vi.fn(),
    } as unknown as ConnectionPool;

    const envWithTarget = {
      MCP_SSH_HOST: "127.0.0.1",
      MCP_SSH_PORT: "22",
      MCP_SSH_USER: "testuser",
    };

    const result = await runDoctor({
      env: envWithTarget,
      connectionPool: mockPool,
      probeTimeoutMs: 1000,
    });

    expect(result.success).toBe(false);
    const sshCheck = result.checks.find((c) => c.name === "SSH 握手与鉴权");
    expect(sshCheck?.status).toBe("FAIL");
    expect(sshCheck?.message).toContain("All configured authentication methods failed");
  });

  it("当 SSE 模式外部绑定未配置 Token 时，doctor 应标记 FAIL 预警安全熔断", async () => {
    const sseBadEnv = {
      MCP_SSH_TRANSPORT: "sse",
      MCP_SSH_SERVER_HOST: "0.0.0.0",
    };

    const result = await runDoctor({ env: sseBadEnv });
    expect(result.success).toBe(false);
    const sseCheck = result.checks.find((c) => c.name.includes("SSE 传输模式与安全鉴权"));
    expect(sseCheck?.status).toBe("FAIL");
    expect(sseCheck?.message).toContain("安全熔断阻断");
  });

  it("当配置了预建隧道与目标白名单时，doctor 应呈现 PASS 诊断信息", async () => {
    const tunnelEnv = {
      MCP_SSH_TUNNEL_TYPE: "socks5",
      MCP_SSH_TUNNEL_LOCAL_PORT: "1080",
      MCP_SSH_ALLOWED_TARGETS: "10.0.0.0/8,192.168.1.0/24",
      MCP_SSH_DISABLE_DYNAMIC_CONNECT: "true",
    };

    const result = await runDoctor({ env: tunnelEnv });
    expect(result.success).toBe(true);
    const tunnelCheck = result.checks.find((c) => c.name === "预建端口转发隧道");
    expect(tunnelCheck?.status).toBe("PASS");
    expect(tunnelCheck?.message).toContain("socks5 隧道");

    const allowCheck = result.checks.find((c) => c.name === "目标主机白名单 (ADR-0017)");
    expect(allowCheck?.status).toBe("PASS");

    const disableCheck = result.checks.find((c) => c.name === "动态建连开关 (ADR-0017)");
    expect(disableCheck?.status).toBe("PASS");
  });
});
