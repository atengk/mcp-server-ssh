/**
 * SSH 端口转发隧道服务单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it, vi } from "vitest";
import { TunnelService } from "./tunnel-service.js";
import type { ConnectionPool } from "../connection/pool.js";

describe("TunnelService 端口转发服务", () => {
  it("应成功开启隧道并支持列出与关闭", async () => {
    let disconnectCallback: ((connId: string) => void) | undefined;
    const mockClient = {
      forwardOut: vi.fn((_sIP, _sPort, _rHost, _rPort, cb) => {
        cb(null, {
          pipe: vi.fn().mockReturnThis(),
          on: vi.fn(),
        });
      }),
    };

    const mockPool = {
      getConnection: vi.fn().mockReturnValue({
        id: "conn_1",
        client: mockClient,
      }),
      getLastConnectionError: vi.fn().mockReturnValue(null),
      onDisconnect: vi.fn((cb) => {
        disconnectCallback = cb;
        return () => {};
      }),
    } as unknown as ConnectionPool;

    const tunnelService = new TunnelService({ connectionPool: mockPool });

    // 1. 开启隧道
    const info = await tunnelService.openTunnel({
      remoteHost: "10.0.0.5",
      remotePort: 3306,
      localPort: 0,
      idleTimeoutSeconds: 60,
    });

    expect(info.tunnelId).toMatch(/^tunnel_/);
    expect(info.localPort).toBeGreaterThan(0);
    expect(info.remoteHost).toBe("10.0.0.5");
    expect(info.remotePort).toBe(3306);
    expect(info.connectionId).toBe("conn_1");

    // 2. 列出隧道
    const list = tunnelService.listTunnels();
    expect(list.length).toBe(1);
    expect(list[0].tunnelId).toBe(info.tunnelId);

    // 3. 关闭隧道
    const closeRes = await tunnelService.closeTunnel({ tunnelId: info.tunnelId });
    expect(closeRes.closed).toBe(true);

    expect(tunnelService.listTunnels().length).toBe(0);
  });

  it("当物理连接断开时应级联销毁关联的隧道", async () => {
    let disconnectCallback: ((connId: string) => void) | undefined;
    const mockPool = {
      getConnection: vi.fn().mockReturnValue({
        id: "conn_victim",
        client: { forwardOut: vi.fn() },
      }),
      getLastConnectionError: vi.fn().mockReturnValue(null),
      onDisconnect: vi.fn((cb) => {
        disconnectCallback = cb;
        return () => {};
      }),
    } as unknown as ConnectionPool;

    const tunnelService = new TunnelService({ connectionPool: mockPool });

    const info = await tunnelService.openTunnel({
      remoteHost: "127.0.0.1",
      remotePort: 6379,
      localPort: 0,
      connectionId: "conn_victim",
    });

    expect(tunnelService.listTunnels().length).toBe(1);

    // 触发断开回调
    disconnectCallback!("conn_victim");

    // 稍等异步关闭
    await new Promise((r) => setTimeout(r, 50));
    expect(tunnelService.listTunnels().length).toBe(0);
  });

  it("当设置了 idleTimeoutSeconds 且超时无连接时应当自动熔断销毁隧道", async () => {
    const mockPool = {
      getConnection: vi.fn().mockReturnValue({
        id: "conn_idle",
        client: { forwardOut: vi.fn() },
      }),
      getLastConnectionError: vi.fn().mockReturnValue(null),
      onDisconnect: vi.fn(() => () => {}),
    } as unknown as ConnectionPool;

    const tunnelService = new TunnelService({ connectionPool: mockPool });

    const info = await tunnelService.openTunnel({
      remoteHost: "127.0.0.1",
      remotePort: 8080,
      localPort: 0,
      idleTimeoutSeconds: 1, // 1 秒空闲超时
    });

    expect(tunnelService.listTunnels().length).toBe(1);

    // 等待超过 1 秒触发熔断定时器
    await new Promise((r) => setTimeout(r, 1200));

    expect(tunnelService.listTunnels().length).toBe(0);
  });
});

