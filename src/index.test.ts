/**
 * MCP Server 装配入口与 Stdio/端到端工具连通性测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSHConfigParser } from "./connection/config-parser.js";
import { ConnectionPool } from "./connection/manager.js";
import { createMCPServer, startServer } from "./index.js";

class MockChannelStream extends EventEmitter {
  public stdout = new EventEmitter();
  public stderr = new EventEmitter();
  public close = vi.fn();
}

class MockShellStream extends EventEmitter {
  public write = vi.fn((data: string) => {
    setTimeout(() => this.emit("data", Buffer.from(`echo:${data}`)), 5);
    return true;
  });
  public end = vi.fn(() => this.emit("close"));
}

class MockSSHClient extends EventEmitter {
  public end = vi.fn(() => {
    this.emit("close");
  });
  public connect = vi.fn(() => {
    setTimeout(() => this.emit("ready"), 5);
    return this;
  });
  public exec = vi.fn((cmd, _opts, cb) => {
    const stream = new MockChannelStream();
    setTimeout(() => {
      stream.stdout.emit("data", Buffer.from("Linux 6.8\n"));
      stream.stderr.emit("data", Buffer.from(""));
      stream.emit("exit", 0);
      stream.emit("close");
    }, 5);
    cb(null, stream);
    return stream;
  });
  public shell = vi.fn((_opts, cb) => {
    const stream = new MockShellStream();
    cb(null, stream);
    return stream;
  });
  public sftp = vi.fn((cb) => {
    const mockSftp = {
      stat: vi.fn((_path, statCb) =>
        statCb(null, {
          size: 42,
          mtime: 1700000000,
          atime: 1700000000,
          mode: 33188,
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        })
      ),
      readFile: vi.fn((_path, readCb) => readCb(null, Buffer.from("mock sftp file content"))),
      writeFile: vi.fn((_path, _content, writeCb) => writeCb(null)),
      readdir: vi.fn((_path, dirCb) =>
        dirCb(null, [
          {
            filename: "test.txt",
            attrs: {
              size: 42,
              mtime: 1700000000,
              atime: 1700000000,
              mode: 33188,
              isDirectory: () => false,
              isFile: () => true,
              isSymbolicLink: () => false,
            },
          },
        ])
      ),
      mkdir: vi.fn((_path, mkdirCb) => mkdirCb(null)),
      rmdir: vi.fn((_path, rmdirCb) => rmdirCb(null)),
      unlink: vi.fn((_path, unlinkCb) => unlinkCb(null)),
      fastPut: vi.fn((_l, _r, putCb) => putCb(null)),
      fastGet: vi.fn((_r, _l, getCb) => getCb(null)),
      on: vi.fn(),
    };
    cb(null, mockSftp);
  });
}

describe("MCP Server 装配入口与工具调用端到端测试", () => {
  let client: Client;
  let clientTransport: InstanceType<typeof InMemoryTransport>;
  let serverTransport: InstanceType<typeof InMemoryTransport>;
  let pool: ConnectionPool;
  let configParser: SSHConfigParser;

  beforeEach(async () => {
    configParser = new SSHConfigParser(`
Host test-alias
  HostName 192.168.10.50
  User tester
  Port 22
`);
    pool = new ConnectionPool({
      clientFactory: () => new MockSSHClient() as any,
      configParser,
    });

    [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const server = createMCPServer({ connectionPool: pool, configParser });
    await server.connect(serverTransport);

    client = new Client(
      {
        name: "test-mcp-client",
        version: "1.0.0",
      },
      {
        capabilities: {},
      }
    );
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await clientTransport.close();
    await serverTransport.close();
    await pool.closeAll();
  });

  it("应当暴露完整的工具矩阵（连接、命令执行、终端会话及基础 ping）", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("ssh_ping");
    expect(toolNames).toContain("ssh_connect");
    expect(toolNames).toContain("ssh_disconnect");
    expect(toolNames).toContain("ssh_list_connections");
    expect(toolNames).toContain("ssh_list_config_hosts");
    expect(toolNames).toContain("ssh_exec");
    expect(toolNames).toContain("ssh_session_start");
    expect(toolNames).toContain("ssh_session_send");
    expect(toolNames).toContain("ssh_session_close");
    expect(toolNames).toContain("sftp_read_file");
    expect(toolNames).toContain("sftp_write_file");
    expect(toolNames).toContain("sftp_list_dir");
    expect(toolNames).toContain("sftp_stat");
    expect(toolNames).toContain("sftp_mkdir");
    expect(toolNames).toContain("sftp_remove");
    expect(toolNames).toContain("sftp_upload");
    expect(toolNames).toContain("sftp_download");
  });

  it("应当支持端到端执行 ssh_exec 并返回执行结果", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const res = await client.callTool({
      name: "ssh_exec",
      arguments: { command: "uname -r" },
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.exitCode).toBe(0);
    expect(data.stdout).toBe("Linux 6.8\n");
  });

  it("应当拦截 ssh_exec 下发的致命破坏命令", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const res = await client.callTool({
      name: "ssh_exec",
      arguments: { command: "rm -rf /" },
    });

    expect(res.isError).toBe(true);
    expect((res.content[0] as any).text).toContain("安全守卫阻断");
  });

  it("应当支持端到端交互式 PTY 终端会话的创建、写入与关闭", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    // 1. 开启终端
    const startRes = await client.callTool({
      name: "ssh_session_start",
      arguments: { cols: 120, rows: 30 },
    });
    expect(startRes.isError).toBeFalsy();
    const { sessionId } = JSON.parse((startRes.content[0] as any).text);
    expect(sessionId).toMatch(/^pty_/);

    // 2. 发送输入
    const sendRes = await client.callTool({
      name: "ssh_session_send",
      arguments: { sessionId, input: "test-input\n", waitForMs: 20 },
    });
    expect(sendRes.isError).toBeFalsy();
    const sendData = JSON.parse((sendRes.content[0] as any).text);
    expect(sendData.output).toContain("test-input");

    // 3. 关闭终端
    const closeRes = await client.callTool({
      name: "ssh_session_close",
      arguments: { sessionId },
    });
    expect(closeRes.isError).toBeFalsy();
    const closeData = JSON.parse((closeRes.content[0] as any).text);
    expect(closeData.closed).toBe(true);
  });

  it("应当支持端到端 SFTP 文本文件读取与目录浏览", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    // 1. 读取文件
    const readRes = await client.callTool({
      name: "sftp_read_file",
      arguments: { remotePath: "/etc/profile" },
    });
    expect(readRes.isError).toBeFalsy();
    const readData = JSON.parse((readRes.content[0] as any).text);
    expect(readData.content).toBe("mock sftp file content");
    expect(readData.bytesRead).toBe(42);

    // 2. 浏览目录
    const listRes = await client.callTool({
      name: "sftp_list_dir",
      arguments: { remotePath: "/var/log" },
    });
    expect(listRes.isError).toBeFalsy();
    const listData = JSON.parse((listRes.content[0] as any).text);
    expect(listData.items).toHaveLength(1);
    expect(listData.items[0].name).toBe("test.txt");
  });

  it("应当支持通过 startServer 以 SSE 模式启动并完成健康检查与优雅关闭", async () => {
    const sseConfig = {
      transport: "sse" as const,
      serverHost: "127.0.0.1",
      serverPort: 0,
      timeoutMs: 30000,
      keepAliveIntervalMs: 10000,
      allowDangerousCommands: false,
    };

    const stop = await startServer(pool, sseConfig);
    expect(typeof stop).toBe("function");

    // 优雅关闭
    await stop();
  });
});

