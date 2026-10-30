/**
 * 宿主机防爆连接熔断器与快速探测超时单元测试
 *
 * @author Ateng
 * @since 2026-10-30
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseEnv } from "../config/env.js";
import { ConnectionCircuitBreaker, HostInCooldownError } from "./circuit-breaker.js";
import { ConnectionPool } from "./pool.js";

describe("ConnectionCircuitBreaker 与 ConnectionPool 熔断防爆保护", () => {
  let currentTimeMs = new Date("2026-10-30T12:00:00.000Z").getTime();

  beforeEach(() => {
    currentTimeMs = new Date("2026-10-30T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockImplementation(() => currentTimeMs);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("当目标主机建连失败时进入 60 秒冷却期，冷却期内再次连接直接抛出 HostInCooldownError 且不新建底层 Socket", async () => {
    let socketCreatedCount = 0;

    const clientFactory = vi.fn(() => {
      socketCreatedCount++;
      const client = new EventEmitter() as any;
      client.end = vi.fn();
      client.destroy = vi.fn();
      client.connect = vi.fn(() => {
        queueMicrotask(() => {
          client.emit("error", new Error("connect ECONNREFUSED 10.0.0.99:22"));
        });
      });
      return client;
    });

    const breaker = new ConnectionCircuitBreaker({ cooldownMs: 60_000 });
    const pool = new ConnectionPool({
      clientFactory,
      circuitBreaker: breaker,
    });

    // 第一次连接失败，触发熔断
    await expect(
      pool.connect({ host: "10.0.0.99", port: 22, username: "root" })
    ).rejects.toThrow("connect ECONNREFUSED 10.0.0.99:22");
    expect(socketCreatedCount).toBe(1);

    // 推进 30 秒（仍在 60 秒冷却期内），再次请求同一目标
    currentTimeMs += 30_000;

    let caughtError: unknown;
    try {
      await pool.connect({ host: "10.0.0.99", port: 22, username: "root" });
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(HostInCooldownError);
    expect((caughtError as HostInCooldownError).targetId).toBe("10.0.0.99:22");
    expect((caughtError as HostInCooldownError).remainingCooldownMs).toBe(30_000);
    // 关键断言：冷却期内严禁调用 clientFactory 新建底层 Socket
    expect(socketCreatedCount).toBe(1);
  });

  it("冷却期满后允许半开探活：若探活失败则刷新 60 秒冷却期，若探活成功则清除熔断状态", async () => {
    let shouldSucceed = false;
    let socketCreatedCount = 0;

    const clientFactory = vi.fn(() => {
      socketCreatedCount++;
      const client = new EventEmitter() as any;
      client.end = vi.fn();
      client.destroy = vi.fn();
      client.connect = vi.fn(() => {
        queueMicrotask(() => {
          if (shouldSucceed) {
            client.emit("ready");
          } else {
            client.emit("error", new Error("All configured authentication methods failed"));
          }
        });
      });
      return client;
    });

    const pool = new ConnectionPool({
      clientFactory,
      cooldownMs: 60_000,
    });

    // 1. 首次鉴权失败，进入 60s 冷却期
    await expect(
      pool.connect({ host: "10.0.0.50", port: 22, username: "admin" })
    ).rejects.toThrow("All configured authentication methods failed");
    expect(socketCreatedCount).toBe(1);
    expect(pool.listFailedTargets()).toHaveLength(1);
    expect(pool.listFailedTargets()[0].state).toBe("open");

    // 2. 推进 60s 冷却期届满，状态变为 half_open，允许发起半开探活
    currentTimeMs += 60_000;
    expect(pool.listFailedTargets()[0].state).toBe("half_open");

    // 半开探活再次失败，刷新 60s 冷却时间
    await expect(
      pool.connect({ host: "10.0.0.50", port: 22, username: "admin" })
    ).rejects.toThrow("All configured authentication methods failed");
    expect(socketCreatedCount).toBe(2);

    // 仅过 40s 时尝试连接，应因冷却时间被刷新而继续拦截
    currentTimeMs += 40_000;
    await expect(
      pool.connect({ host: "10.0.0.50", port: 22, username: "admin" })
    ).rejects.toThrow(HostInCooldownError);
    expect(socketCreatedCount).toBe(2);

    // 3. 再推进 20s（满 60s），此时远端恢复正常，半开探活成功
    currentTimeMs += 20_000;
    shouldSucceed = true;

    const info = await pool.connect({ host: "10.0.0.50", port: 22, username: "admin" });
    expect(info.host).toBe("10.0.0.50");
    expect(socketCreatedCount).toBe(3);
    // 成功后熔断记录应被彻底清除
    expect(pool.listFailedTargets()).toHaveLength(0);
  });

  it("当底层握手挂起超过探测超时时，应主动中断握手、立即释放底层资源并触发熔断", async () => {
    const endSpy = vi.fn();
    const destroySpy = vi.fn();
    let socketCreatedCount = 0;

    const clientFactory = vi.fn(() => {
      socketCreatedCount++;
      const client = new EventEmitter() as any;
      client.end = endSpy;
      client.destroy = destroySpy;
      // 模拟黑洞主机：connect 调用后永远不触发 ready 或 error
      client.connect = vi.fn();
      return client;
    });

    const pool = new ConnectionPool({
      clientFactory,
      connectTimeoutMs: 50,
    });

    await expect(
      pool.connect({
        host: "10.0.0.254",
        port: 22,
        username: "root",
      })
    ).rejects.toThrow(/连接探测超时 \(50ms\)/);

    // 验证超时后立即释放底层 Socket/Client 资源
    expect(endSpy).toHaveBeenCalledTimes(1);
    expect(destroySpy).toHaveBeenCalledTimes(1);

    // 验证超时失败后该主机已被置入熔断冷却期，后续请求不再分配新 Socket
    await expect(
      pool.connect({ host: "10.0.0.254", port: 22, username: "root" })
    ).rejects.toThrow(HostInCooldownError);
    expect(socketCreatedCount).toBe(1);
  });

  it("支持通过 MCP_SSH_CONNECT_TIMEOUT_MS 与 ConnectionPoolOptions 自定义连接探测超时时间", async () => {
    expect(parseEnv({}).connectTimeoutMs).toBe(6_000);
    expect(parseEnv({ MCP_SSH_CONNECT_TIMEOUT_MS: "3500" }).connectTimeoutMs).toBe(3_500);
    expect(() => parseEnv({ MCP_SSH_CONNECT_TIMEOUT_MS: "0" })).toThrow(/必须为正整数/);

    const endSpy = vi.fn();
    const pool = new ConnectionPool({
      connectTimeoutMs: 40,
      clientFactory: () => {
        const client = new EventEmitter() as any;
        client.end = endSpy;
        client.destroy = vi.fn();
        client.connect = vi.fn();
        return client;
      },
    });

    await expect(
      pool.connect({ host: "10.0.0.200", username: "root" })
    ).rejects.toThrow(/连接探测超时 \(40ms\)/);
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
