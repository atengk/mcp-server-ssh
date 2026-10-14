/**
 * SFTPService 文件系统服务单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import zlib from "node:zlib";
import tar from "tar-stream";
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
  public exec = vi.fn((_cmd: string, cb: Function) => {
    const stream = new PassThrough() as any;
    stream.stderr = new PassThrough();
    cb(null, stream);
    return stream;
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

  it("应当能够成功执行差异补丁替换", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const patchResult = await service.patchFile({
      remotePath: "/etc/hosts",
      targetContent: "127.0.0.1 localhost",
      replacementContent: "127.0.0.1 localhost.localdomain",
    });

    expect(patchResult.success).toBe(true);
    expect(patchResult.matchesReplaced).toBe(1);
    expect(mockClient.mockSftp.writeFile).toHaveBeenCalled();
    expect(mockClient.mockSftp.files.get("/etc/hosts")).toContain("127.0.0.1 localhost.localdomain\n");
  });

  it("当差异补丁目标文本未找到时应抛出语义异常", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    await expect(
      service.patchFile({
        remotePath: "/etc/hosts",
        targetContent: "non-existent-line",
        replacementContent: "new-line",
      })
    ).rejects.toThrow("待替换的目标文本块未在远程文件");
  });

  it("差异补丁替换内容包含 $ 特殊字符时，不应被正则引擎误展开", async () => {
    const mockClient = new MockSFTPClient();
    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const service = new SFTPService({ connectionPool: pool });
    const patchResult = await service.patchFile({
      remotePath: "/etc/hosts",
      targetContent: "127.0.0.1 localhost",
      replacementContent: 'export PATH="$PATH:/usr/local/bin" && echo $1',
    });

    expect(patchResult.success).toBe(true);
    const content = mockClient.mockSftp.files.get("/etc/hosts");
    expect(content).toContain('export PATH="$PATH:/usr/local/bin" && echo $1');
  });

  it("应当支持通过流式 Tar 打包上传本地目录", async () => {
    const mockClient = new MockSFTPClient();
    const mockStream = new PassThrough() as any;
    mockStream.stderr = new PassThrough();
    mockClient.exec = vi.fn((_cmd: string, cb: Function) => {
      cb(null, mockStream);
      mockStream.on("finish", () => {
        mockStream.emit("close", 0);
      });
      return mockStream;
    });

    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    // 创建本地临时测试目录及文件
    const tmpDir = path.join(os.tmpdir(), `mcp_upload_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "file1.txt"), "hello upload 1");
    fs.writeFileSync(path.join(tmpDir, "file2.txt"), "hello upload 2");

    try {
      const service = new SFTPService({ connectionPool: pool });
      const result = await service.uploadDir({
        localPath: tmpDir,
        remotePath: "/remote/test/upload",
      });

      expect(result.success).toBe(true);
      expect(result.totalFiles).toBe(2);
      expect(result.remotePath).toBe("/remote/test/upload");
      expect(mockClient.exec).toHaveBeenCalled();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("应当支持通过流式 Tar 打包并在本地解压下载远程目录", async () => {
    const mockClient = new MockSFTPClient();
    const mockStream = new PassThrough() as any;
    mockStream.stderr = new PassThrough();
    mockClient.exec = vi.fn((_cmd: string, cb: Function) => {
      cb(null, mockStream);
      // 模拟远程端输出 tar.gz 流
      const pack = tar.pack();
      pack.entry({ name: "downloaded.txt", mode: 0o644 }, "Hello from remote tar stream!");
      pack.finalize();
      const gzip = zlib.createGzip();
      pack.pipe(gzip).pipe(mockStream);
      gzip.on("end", () => {
        mockStream.emit("close", 0);
      });
      return mockStream;
    });

    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const localDestDir = path.join(os.tmpdir(), `mcp_download_test_${Date.now()}`);
    fs.mkdirSync(localDestDir, { recursive: true });

    try {
      const service = new SFTPService({ connectionPool: pool });
      const result = await service.downloadDir({
        remotePath: "/remote/data",
        localPath: localDestDir,
      });

      expect(result.success).toBe(true);
      expect(result.remotePath).toBe("/remote/data");
      expect(result.localPath).toBe(localDestDir);

      const targetFile = path.join(localDestDir, "downloaded.txt");
      expect(fs.existsSync(targetFile)).toBe(true);
      expect(fs.readFileSync(targetFile, "utf-8")).toBe("Hello from remote tar stream!");
    } finally {
      fs.rmSync(localDestDir, { recursive: true, force: true });
    }
  });

  it("uploadDir 应当支持 excludePatterns 过滤规则并忽略匹配的文件与目录", async () => {
    const mockClient = new MockSFTPClient();
    const mockStream = new PassThrough() as any;
    mockStream.stderr = new PassThrough();
    mockClient.exec = vi.fn((_cmd: string, cb: Function) => {
      cb(null, mockStream);
      mockStream.on("finish", () => {
        mockStream.emit("close", 0);
      });
      return mockStream;
    });

    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const tmpDir = path.join(os.tmpdir(), `mcp_upload_filter_${Date.now()}`);
    fs.mkdirSync(path.join(tmpDir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "node_modules/pkg.json"), "{}");
    fs.writeFileSync(path.join(tmpDir, "app.ts"), "console.log('app');");
    fs.writeFileSync(path.join(tmpDir, "debug.log"), "debug output");

    try {
      const service = new SFTPService({ connectionPool: pool });
      const result = await service.uploadDir({
        localPath: tmpDir,
        remotePath: "/remote/project",
        excludePatterns: ["node_modules", "*.log"],
      });

      expect(result.success).toBe(true);
      // 只有 app.ts 被包含在上传清单中，node_modules 和 debug.log 被排除
      expect(result.totalFiles).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("downloadDir 应当将 excludePatterns 转换为 remote tar 的 --exclude 参数", async () => {
    let executedRemoteCmd = "";
    const mockClient = new MockSFTPClient();
    const mockStream = new PassThrough() as any;
    mockStream.stderr = new PassThrough();
    mockClient.exec = vi.fn((cmd: string, cb: Function) => {
      executedRemoteCmd = cmd;
      cb(null, mockStream);
      const pack = tar.pack();
      pack.finalize();
      const gzip = zlib.createGzip();
      pack.pipe(gzip).pipe(mockStream);
      gzip.on("end", () => {
        mockStream.emit("close", 0);
      });
      return mockStream;
    });

    const pool = new ConnectionPool({
      clientFactory: () => mockClient as any,
    });
    await pool.connect({ host: "127.0.0.1", username: "root" });

    const localDestDir = path.join(os.tmpdir(), `mcp_download_filter_${Date.now()}`);
    fs.mkdirSync(localDestDir, { recursive: true });

    try {
      const service = new SFTPService({ connectionPool: pool });
      await service.downloadDir({
        remotePath: "/remote/repo",
        localPath: localDestDir,
        excludePatterns: ["node_modules", "*.tmp"],
      });

      expect(executedRemoteCmd).toContain("--exclude='node_modules'");
      expect(executedRemoteCmd).toContain("--exclude='*.tmp'");
    } finally {
      fs.rmSync(localDestDir, { recursive: true, force: true });
    }
  });
});



