/**
 * SSH 端口转发隧道服务单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import net from "node:net";
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

  it("应成功开启远程反向端口转发 (type: remote)", async () => {
    let unforwardCalled = false;
    const mockClient = {
      forwardIn: vi.fn((_rHost, _rPort, cb) => {
        cb(null, 9090); // 远程实际绑定的端口
      }),
      unforwardIn: vi.fn((_rHost, _rPort, cb) => {
        unforwardCalled = true;
        if (cb) cb(null);
      }),
      on: vi.fn(),
      removeListener: vi.fn(),
    };

    const mockPool = {
      getConnection: vi.fn().mockReturnValue({
        id: "conn_remote_fwd",
        client: mockClient,
      }),
      onDisconnect: vi.fn(() => () => {}),
    } as unknown as ConnectionPool;

    const tunnelService = new TunnelService({ connectionPool: mockPool });
    const info = await tunnelService.openTunnel({
      type: "remote",
      remoteHost: "0.0.0.0",
      remotePort: 9090,
      localHost: "127.0.0.1",
      localPort: 3000,
    });

    expect(info.type).toBe("remote");
    expect(info.remotePort).toBe(9090);
    expect(mockClient.forwardIn).toHaveBeenCalled();

    // 关闭反向隧道
    await tunnelService.closeTunnel({ tunnelId: info.tunnelId });
    expect(unforwardCalled).toBe(true);
  });

  it("应成功开启本地动态 SOCKS5 代理 (type: socks5) 并支持握手", async () => {
    const mockClient = {
      forwardOut: vi.fn((_sIP, _sPort, _dHost, _dPort, cb) => {
        cb(null, {
          pipe: vi.fn().mockReturnThis(),
          on: vi.fn(),
        });
      }),
    };

    const mockPool = {
      getConnection: vi.fn().mockReturnValue({
        id: "conn_socks5",
        client: mockClient,
      }),
      onDisconnect: vi.fn(() => () => {}),
    } as unknown as ConnectionPool;

    const tunnelService = new TunnelService({ connectionPool: mockPool });
    const info = await tunnelService.openTunnel({
      type: "socks5",
      localPort: 0,
    });

    expect(info.type).toBe("socks5");
    expect(info.localPort).toBeGreaterThan(0);

    // 通过 net 客户端连接该 SOCKS5 端口并发送握手包 [0x05, 0x01, 0x00]
    const client = net.connect(info.localPort, "127.0.0.1");
    const handshakeResponse = await new Promise<Buffer>((resolve) => {
      client.on("connect", () => {
        client.write(Buffer.from([0x05, 0x01, 0x00]));
      });
      client.on("data", (chunk) => {
        resolve(chunk);
        client.destroy();
      });
    });

    // SOCKS5 协议无认证响应: [0x05, 0x00]
    expect(handshakeResponse[0]).toBe(0x05);
    expect(handshakeResponse[1]).toBe(0x00);

    await tunnelService.closeTunnel({ tunnelId: info.tunnelId });
  });
});

