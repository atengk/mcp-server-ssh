/**
 * SSH 连接池管理器单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPool } from "./manager.js";

/**
 * 模拟的 SSH2 客户端
 */
class MockSSH2Client extends EventEmitter {
  public end = vi.fn(() => {
    this.emit("close");
  });
  public connect = vi.fn(() => {
    // 异步触发 ready 事件
    setTimeout(() => {
      this.emit("ready");
    }, 10);
    return this;
  });
  public forwardOut = vi.fn((_srcIP, _srcPort, _destIP, _destPort, cb) => {
    const mockStream = new EventEmitter();
    cb(null, mockStream);
  });
}

describe("ConnectionPool 连接池管理器", () => {
  it("应当成功建立连接并将其记录在活跃连接表中", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockSSH2Client() as any,
    });

    const info = await pool.connect({
      host: "10.0.0.1",
      port: 22,
      username: "root",
      connectionId: "conn-1",
      setAsDefault: true,
    });

    expect(info.connectionId).toBe("conn-1");
    expect(info.host).toBe("10.0.0.1");
    expect(info.isDefault).toBe(true);

    const list = pool.listConnections();
    expect(list).toHaveLength(1);
    expect(list[0].connectionId).toBe("conn-1");
  });

  it("当未指定 connectionId 时应当能自动按序生成唯一标识符", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockSSH2Client() as any,
    });

    const info1 = await pool.connect({ host: "10.0.0.1", username: "root" });
    const info2 = await pool.connect({ host: "10.0.0.2", username: "root" });

    expect(info1.connectionId).toBe("conn_1");
    expect(info2.connectionId).toBe("conn_2");
    expect(pool.listConnections()).toHaveLength(2);
  });

  it("在未传入 connectionId 时，应当自动路由到当前默认连接", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockSSH2Client() as any,
    });

    await pool.connect({ host: "10.0.0.1", username: "root", connectionId: "c1", setAsDefault: false });
    await pool.connect({ host: "10.0.0.2", username: "root", connectionId: "c2", setAsDefault: true });

    const defaultConn = pool.getConnection();
    expect(defaultConn).toBeDefined();
    expect(defaultConn?.id).toBe("c2");

    const specificConn = pool.getConnection("c1");
    expect(specificConn?.id).toBe("c1");
  });

  it("关闭连接时应当正确释放资源并更新连接列表", async () => {
    const pool = new ConnectionPool({
      clientFactory: () => new MockSSH2Client() as any,
    });

    await pool.connect({ host: "10.0.0.1", username: "root", connectionId: "c1" });
    expect(pool.listConnections()).toHaveLength(1);

    const disconnected = await pool.disconnect("c1");
    expect(disconnected).toBe(true);
    expect(pool.listConnections()).toHaveLength(0);
    expect(pool.getConnection()).toBeUndefined();
  });
});
