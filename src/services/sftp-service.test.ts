/**
 * SFTPService 文件系统服务单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ConnectionPool } from "../connection/manager.js";
import { SFTPService } from "./sftp-service.js";

/**
 * 模拟的 SFTP 文件属性
 */
function createMockAttrs(isDirectory = false, size = 1024) {
  return {
    size,
    mtime: 1700000000,
    atime: 1700000000,
    mode: isDirectory ? 16877 : 33188, // 0755 or 0644
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isSymbolicLink: () => false,
  };
}

/**
 * 模拟的 SFTP 实例
 */
class MockSFTPWrapper extends EventEmitter {
  public files = new Map<string, string>();

  public stat = vi.fn((remotePath: string, cb: Function) => {
    if (remotePath === "/etc/hosts") {
      cb(null, createMockAttrs(false, 100));
    } else if (remotePath === "/huge.log") {
      cb(null, createMockAttrs(false, 1024 * 1024)); // 1MB
    } else if (remotePath === "/var/log") {
      cb(null, createMockAttrs(true, 4096));
    } else {
      const err = new Error("No such file or directory");
      (err as any).code = 2; // SSH_FX_NO_SUCH_FILE
      cb(err);
    }
  });

  public readFile = vi.fn((remotePath: string, cb: Function) => {
    if (remotePath === "/etc/hosts") {
      cb(null, Buffer.from("127.0.0.1 localhost\n"));
    } else {
      cb(new Error("File not found"));
    }
  });

  public writeFile = vi.fn((remotePath: string, content: string | Buffer, cb: Function) => {
    this.files.set(remotePath, content.toString());
    cb(null);
  });

  public readdir = vi.fn((remotePath: string, cb: Function) => {
    if (remotePath === "/var/log") {
      cb(null, [
        { filename: "syslog", attrs: createMockAttrs(false, 5000) },
        { filename: "nginx", attrs: createMockAttrs(true, 4096) },
      ]);
    } else {
      cb(new Error("Directory not found"));
    }
  });

  public mkdir = vi.fn((_remotePath: string, cb: Function) => {
    cb(null);
  });

  public unlink = vi.fn((_remotePath: string, cb: Function) => {
    cb(null);
  });

  public rmdir = vi.fn((_remotePath: string, cb: Function) => {
    cb(null);
  });

  public fastPut = vi.fn((_local: string, _remote: string, cb: Function) => {
    cb(null);
  });

  public fastGet = vi.fn((_remote: string, _local: string, cb: Function) => {
    cb(null);
  });
}

class MockSFTPClient extends EventEmitter {
  public mockSftp = new MockSFTPWrapper();
  public connect = vi.fn(() => {
    setTimeout(() => this.emit("ready"), 5);
    return this;
  });
  public end = vi.fn(() => this.emit("close"));
  public sftp = vi.fn((cb: Function) => {
    cb(null, this.mockSftp);
  });
}

describe("SFTPService POSIX 远程文件系统服务", () => {
  it("应当能够成功读取远程文本文件内容", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const result = await service.readFile({ remotePath: "/etc/hosts" });

    expect(result.content).toContain("127.0.0.1 localhost");
    expect(result.bytesRead).toBe(100);
  });

  it("当读取超过最大字节数限制的大文件时，应当主动阻断并抛出友好建议", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    await expect(
      service.readFile({
        remotePath: "/huge.log",
        maxBytes: 524288, // 512KB
      })
    ).rejects.toThrow("超出最大读取限制");
  });

  it("应当能够成功写入并覆盖远程文本文件", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const writeResult = await service.writeFile({
      remotePath: "/etc/nginx/nginx.conf",
      content: "worker_processes auto;",
    });

    expect(writeResult.success).toBe(true);
    expect(mockClient.mockSftp.files.get("/etc/nginx/nginx.conf")).toBe("worker_processes auto;");
  });

  it("应当能够列出远程目录并返回格式化的 POSIX 元数据列表", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const listResult = await service.listDir({ remotePath: "/var/log" });

    expect(listResult.path).toBe("/var/log");
    expect(listResult.items).toHaveLength(2);
    expect(listResult.items[0].name).toBe("syslog");
    expect(listResult.items[0].isFile).toBe(true);
    expect(listResult.items[1].name).toBe("nginx");
    expect(listResult.items[1].isDirectory).toBe(true);
  });

  it("应当能够获取特定文件的 POSIX 属性", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const statResult = await service.stat({ remotePath: "/etc/hosts" });

    expect(statResult.stat.name).toBe("hosts");
    expect(statResult.stat.size).toBe(100);
  });

  it("应当能够创建目录及删除文件", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const mkdirResult = await service.mkdir({ remotePath: "/data/logs", recursive: true });
    expect(mkdirResult.created).toBe(true);

    const removeResult = await service.remove({ remotePath: "/etc/hosts" });
    expect(removeResult.removed).toBe(true);
  });

  it("应当能够成功上传本地文件到远程路径", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const localFile = path.resolve(process.cwd(), "package.json");
    const uploadResult = await service.upload({
      localPath: localFile,
      remotePath: "/tmp/package.json",
    });

    expect(uploadResult.success).toBe(true);
    expect(mockClient.mockSftp.fastPut).toHaveBeenCalled();
  });

  it("应当能够成功从远程路径下载文件到本地", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const localDest = path.resolve(process.cwd(), "dist/test-download.tmp");
    const downloadResult = await service.download({
      remotePath: "/etc/hosts",
      localPath: localDest,
    });

    expect(downloadResult.success).toBe(true);
    expect(mockClient.mockSftp.fastGet).toHaveBeenCalled();
  });
});

