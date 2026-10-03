/**
 * 数据契约与 Zod Schema 单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { describe, expect, it } from "vitest";
import {
  SSHConnectParamsSchema,
  SSHExecParamsSchema,
  SSHSessionStartParamsSchema,
  SFTPReadFileParamsSchema,
  SFTPWriteFileParamsSchema,
} from "./index.js";

describe("数据模型与 Zod Schema 契约校验", () => {
  it("应当正确解析合法的 SSH 连接参数", () => {
    const raw = {
      host: "192.168.1.100",
      port: 22,
      username: "root",
      password: "secret_password",
      setAsDefault: true,
    };
    const parsed = SSHConnectParamsSchema.parse(raw);
    expect(parsed.host).toBe("192.168.1.100");
    expect(parsed.port).toBe(22);
    expect(parsed.username).toBe("root");
    expect(parsed.setAsDefault).toBe(true);
  });

  it("应当为缺省的端口与默认连接状态提供合理的默认值", () => {
    const raw = {
      host: "example.com",
      username: "admin",
    };
    const parsed = SSHConnectParamsSchema.parse(raw);
    expect(parsed.port).toBe(22);
    expect(parsed.setAsDefault).toBe(true);
  });

  it("应当验证命令执行参数的边界与默认超时", () => {
    const raw = {
      command: "uname -a",
    };
    const parsed = SSHExecParamsSchema.parse(raw);
    expect(parsed.command).toBe("uname -a");
    expect(parsed.timeoutMs).toBe(60000);
    expect(parsed.dryRun).toBe(false);
  });

  it("应当拒绝空字符串的命令入参", () => {
    const raw = {
      command: "",
    };
    expect(() => SSHExecParamsSchema.parse(raw)).toThrow();
  });

  it("应当验证 PTY 终端会话创建参数默认行列数", () => {
    const parsed = SSHSessionStartParamsSchema.parse({});
    expect(parsed.cols).toBe(120);
    expect(parsed.rows).toBe(30);
  });

  it("应当校验 SFTP 读取参数的最大字节数默认值", () => {
    const parsed = SFTPReadFileParamsSchema.parse({
      remotePath: "/etc/hosts",
    });
    expect(parsed.remotePath).toBe("/etc/hosts");
    expect(parsed.maxBytes).toBe(524288); // 512KB
    expect(parsed.encoding).toBe("utf-8");
  });

  it("应当拒绝非正斜杠开头的远程文件路径", () => {
    expect(() =>
      SFTPReadFileParamsSchema.parse({
        remotePath: "relative/path/test.txt",
      })
    ).toThrow();
  });

  it("应当正确解析 SFTP 文件写入参数与父目录自动创建默认值", () => {
    const parsed = SFTPWriteFileParamsSchema.parse({
      remotePath: "/var/log/custom.log",
      content: "Hello Linux MCP",
    });
    expect(parsed.createDirectories).toBe(true);
    expect(parsed.content).toBe("Hello Linux MCP");
  });
});
