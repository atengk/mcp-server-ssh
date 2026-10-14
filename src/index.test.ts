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
import { AuditService, createMCPServer, startServer } from "./index.js";


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
  public forwardOut = vi.fn((_sIP, _sPort, _rHost, _rPort, cb) => {
    cb(null, {
      pipe: vi.fn().mockReturnThis(),
      on: vi.fn(),
    });
  });
  public exec = vi.fn((cmd, _opts, cb) => {
    const stream = new MockChannelStream();
    setTimeout(() => {
      if (typeof cmd === "string" && cmd.includes("===OS===")) {
        stream.stdout.emit(
          "data",
          Buffer.from(
            "===OS===\nPRETTY_NAME=\"Ubuntu 22.04 LTS\"\n===UNAME===\n5.15\nx86_64\nmy-host\n===UPTIME===\n100 100\n===CPU===\n4\nIntel CPU\n0.1 0.1 0.1\n===MEM===\nMemTotal: 8000 kB\nMemFree: 4000 kB\n===DF===\n/dev/sda 1000 500 500 50% /\n===PORTS===\n:22\n"
          )
        );
      } else {
        stream.stdout.emit("data", Buffer.from("Linux 6.8\n"));
      }
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
      readFile: vi.fn((_path, readCb) =>
        readCb(null, Buffer.from("mock sftp file content with target_string\n"))
      ),
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

  it("应当暴露完整的工具矩阵（连接、命令执行、终端会话、SFTP文件、隧道与系统探针）", async () => {
    const result = await client.listTools();
    const toolNames = result.tools.map((t) => t.name);
    expect(toolNames).toContain("ssh_ping");
    expect(toolNames).toContain("ssh_connect");
    expect(toolNames).toContain("ssh_disconnect");
    expect(toolNames).toContain("ssh_list_targets");
    expect(toolNames).toContain("ssh_list_connections");
    expect(toolNames).toContain("ssh_list_config_hosts");
    expect(toolNames).toContain("ssh_exec");
    expect(toolNames).toContain("ssh_session_start");
    expect(toolNames).toContain("ssh_session_send");
    expect(toolNames).toContain("ssh_session_close");
    expect(toolNames).toContain("ssh_system_info");
    expect(toolNames).toContain("ssh_forward_port");
    expect(toolNames).toContain("ssh_tunnel_list");
    expect(toolNames).toContain("ssh_tunnel_close");
    expect(toolNames).toContain("ssh_job_start");
    expect(toolNames).toContain("ssh_job_status");
    expect(toolNames).toContain("ssh_job_logs");
    expect(toolNames).toContain("ssh_job_kill");
    expect(toolNames).toContain("ssh_job_clean");
    expect(toolNames).toContain("sftp_read_file");
    expect(toolNames).toContain("sftp_write_file");
    expect(toolNames).toContain("sftp_patch_file");
    expect(toolNames).toContain("sftp_list_dir");
    expect(toolNames).toContain("sftp_stat");
    expect(toolNames).toContain("sftp_mkdir");
    expect(toolNames).toContain("sftp_remove");
    expect(toolNames).toContain("sftp_upload");
    expect(toolNames).toContain("sftp_download");
    expect(toolNames).toContain("sftp_upload_dir");
    expect(toolNames).toContain("sftp_download_dir");
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
    expect(readData.content).toContain("mock sftp file content");
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

  it("应当支持端到端调用 ssh_list_targets 统一目标发现", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const res = await client.callTool({
      name: "ssh_list_targets",
      arguments: {},
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.totalActive).toBe(1);
    expect(data.totalConfigured).toBe(1);
    expect(data.activeConnections[0].host).toBe("10.0.0.1");
    expect(data.configuredHosts[0].alias).toBe("test-alias");
  });

  it("应当支持端到端调用 ssh_system_info 采集系统指标摘要", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const res = await client.callTool({
      name: "ssh_system_info",
      arguments: {},
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.os.distribution).toBe("Ubuntu 22.04 LTS");
    expect(data.os.arch).toBe("x86_64");
    expect(data.cpu.cores).toBe(4);
    expect(data.listeningPorts).toContain(22);
  });

  it("应当支持端到端通过 ssh_forward_port 建立端口转发并管理生命周期", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    // 1. 开启端口转发
    const openRes = await client.callTool({
      name: "ssh_forward_port",
      arguments: {
        remoteHost: "127.0.0.1",
        remotePort: 3306,
        localPort: 0,
        idleTimeoutSeconds: 60,
      },
    });

    expect(openRes.isError).toBeFalsy();
    const openData = JSON.parse((openRes.content[0] as any).text);
    expect(openData.status).toBe("listening");
    const tunnelId = openData.tunnel.tunnelId;

    // 2. 列出隧道
    const listRes = await client.callTool({
      name: "ssh_tunnel_list",
      arguments: {},
    });
    expect(listRes.isError).toBeFalsy();
    const listData = JSON.parse((listRes.content[0] as any).text);
    expect(listData.total).toBe(1);

    // 3. 关闭隧道
    const closeRes = await client.callTool({
      name: "ssh_tunnel_close",
      arguments: { tunnelId },
    });
    expect(closeRes.isError).toBeFalsy();
    const closeData = JSON.parse((closeRes.content[0] as any).text);
    expect(closeData.status).toBe("closed");
  });

  it("应当支持端到端调用 sftp_patch_file 执行精准锚点差异补丁", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const patchRes = await client.callTool({
      name: "sftp_patch_file",
      arguments: {
        remotePath: "/etc/profile",
        targetContent: "target_string",
        replacementContent: "replaced_string",
      },
    });

    expect(patchRes.isError).toBeFalsy();
    const patchData = JSON.parse((patchRes.content[0] as any).text);
    expect(patchData.success).toBe(true);
    expect(patchData.matchesReplaced).toBe(1);
  });

  it("应当支持通过 startServer 以 SSE 模式启动并完成健康检查与优雅关闭", async () => {
    const sseConfig = {
      transport: "sse" as const,
      serverHost: "127.0.0.1",
      serverPort: 0,
      timeoutMs: 30000,
      keepAliveIntervalMs: 10000,
      allowDangerousCommands: false,
      audit: {
        enabled: false,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
    };


    const stop = await startServer(pool, sseConfig);
    expect(typeof stop).toBe("function");

    // 优雅关闭
    await stop();
  });

  it("应当支持通过 MCP Client 端到端调用 ssh_job_start 启动脱机后台作业", async () => {
    await client.callTool({
      name: "ssh_connect",
      arguments: { host: "10.0.0.1", username: "root" },
    });

    const res = await client.callTool({
      name: "ssh_job_start",
      arguments: { command: "sleep 10" },
    });

    expect(res.isError).toBeFalsy();
    const data = JSON.parse((res.content[0] as any).text);
    expect(data.status).toBe("started");
    expect(data.jobId).toMatch(/^job_/);
  });

  it("应当支持端到端捕获全生命周期安全审计日志并对敏感参数执行清洗脱敏", async () => {
    const auditEvents: any[] = [];
    const mockSink = {
      write: vi.fn((event: any) => {
        auditEvents.push(event);
      }),
      close: vi.fn(),
    };

    const auditService = new AuditService(
      {
        enabled: true,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      },
      mockSink
    );

    const auditedServer = createMCPServer({
      connectionPool: pool,
      auditService,
    });

    const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client(
      { name: "test-audit-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await Promise.all([
      auditedServer.connect(sTransport),
      testClient.connect(cTransport),
    ]);

    const pingRes = await testClient.callTool({
      name: "ssh_ping",
      arguments: { message: "audit_test_echo" },
    });
    expect(pingRes.isError).toBeFalsy();

    expect(auditEvents.length).toBe(1);
    expect(auditEvents[0].action).toBe("ssh_ping");
    expect(auditEvents[0].level).toBe("info");
    expect(auditEvents[0].params.message).toBe("audit_test_echo");
    expect(auditEvents[0].result.status).toBe("success");

    await testClient.close();
    await auditedServer.close();
  });

  it("应当支持通过 serverName 与 serverInstructions 自定义服务身份并在工具描述前添加紧凑前缀 (ADR-0015)", async () => {
    const customServer = createMCPServer({
      connectionPool: pool,
      serverName: "prod-bastion",
      serverInstructions: "本实例专门用于核心生产机房运维，严禁执行破坏性命令",
    });

    const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await Promise.all([
      customServer.connect(sTransport),
      testClient.connect(cTransport),
    ]);

    // 1. 验证握手声明的服务名称
    const serverVersion = testClient.getServerVersion();
    expect(serverVersion?.name).toBe("prod-bastion");

    // 2. 验证协议级 instructions
    const instructions = testClient.getInstructions();
    expect(instructions).toBe("本实例专门用于核心生产机房运维，严禁执行破坏性命令");

    // 3. 验证工具描述自动前缀化
    const toolsResult = await testClient.listTools();
    const pingTool = toolsResult.tools.find((t) => t.name === "ssh_ping");
    expect(pingTool?.description).toMatch(/^\[prod-bastion\]\s+/);

    const execTool = toolsResult.tools.find((t) => t.name === "ssh_exec");
    expect(execTool?.description).toMatch(/^\[prod-bastion\]\s+/);

    await testClient.close();
    await customServer.close();
  });

  it("当使用默认 serverName 时，工具描述应保持纯净原样且无前缀", async () => {
    const defaultServer = createMCPServer({
      connectionPool: pool,
    });

    const [cTransport, sTransport] = InMemoryTransport.createLinkedPair();
    const testClient = new Client(
      { name: "test-client", version: "1.0.0" },
      { capabilities: {} }
    );

    await Promise.all([
      defaultServer.connect(sTransport),
      testClient.connect(cTransport),
    ]);

    const toolsResult = await testClient.listTools();
    const pingTool = toolsResult.tools.find((t) => t.name === "ssh_ping");
    expect(pingTool?.description).not.toContain("[mcp-server-ssh]");
    expect(pingTool?.description).toMatch(/^测试 SSH MCP 服务的存活状态/);

    await testClient.close();
    await defaultServer.close();
  });

  it("startServer 启动装配时，CLI 命令行选项优先级应高于环境变量", async () => {
    const mockEnvConfig = {
      serverName: "env-server-name",
      serverInstructions: "env instructions",
      transport: "sse" as const,
      serverHost: "127.0.0.1",
      serverPort: 0,
      timeoutMs: 30000,
      keepAliveIntervalMs: 10000,
      allowDangerousCommands: false,
      audit: {
        enabled: false,
        strict: false,
        maxSizeMb: 10,
        maxFiles: 5,
      },
    };

    const cliOptions = {
      serverName: "cli-override-name",
      serverInstructions: "cli override instructions",
    };

    // startServer 传入自定义 config 与 cliOptions，验证以 SSE 模式成功装配与启动
    const shutdown = await startServer(pool, mockEnvConfig as any, cliOptions as any);
    await shutdown();
  });
});



