/**
 * SFTP POSIX 文件系统管理服务
 *
 * @author Ateng
 * @since 2026-10-03
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import tar from "tar-stream";
import type { SFTPWrapper } from "ssh2";
import type { ConnectionPool } from "../connection/pool.js";
import type {
  SFTPDownloadDirParams,
  SFTPDownloadParams,
  SFTPItem,
  SFTPListDirParams,
  SFTPMkdirParams,
  SFTPPatchFileParams,
  SFTPReadFileParams,
  SFTPRemoveParams,
  SFTPStatParams,
  SFTPUploadDirParams,
  SFTPUploadParams,
  SFTPWriteFileParams,
} from "../types/sftp.js";


/**
 * SFTP 选项配置
 */
export interface SFTPServiceOptions {
  connectionPool: ConnectionPool;
}

/**
 * 格式化 POSIX 权限数字为字符标记（例如 rwxr-xr-x）
 *
 * @param mode 文件权限 mode
 * @return 标准 POSIX 权限字符
 */
function formatPermissions(mode?: number): string {
  if (typeof mode !== "number") {
    return "rw-r--r--";
  }
  const rwx = (m: number) => {
    return (
      (m & 4 ? "r" : "-") +
      (m & 2 ? "w" : "-") +
      (m & 1 ? "x" : "-")
    );
  };
  const u = rwx((mode >> 6) & 7);
  const g = rwx((mode >> 3) & 7);
  const o = rwx(mode & 7);
  return `${u}${g}${o}`;
}

/**
 * POSIX SFTP 远程文件系统服务
 */
export class SFTPService {
  private connectionPool: ConnectionPool;
  private sftpSessions = new Map<string, Promise<SFTPWrapper>>();

  public constructor(options: SFTPServiceOptions) {
    this.connectionPool = options.connectionPool;
  }

  /**
   * 读取远程文本文件内容
   *
   * @param params 读取入参
   * @return 文件文本内容及实际字节大小
   * @throws 当文件大小超过最大字节限制或读取失败时抛出异常
   */
  public async readFile(
    params: SFTPReadFileParams
  ): Promise<{ content: string; bytesRead: number }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);

    // 1. 前置获取文件元数据并检查文件大小
    const stats = await this.statInternal(sftp, normalizedPath);
    const maxBytes = params.maxBytes ?? 524288; // 默认 512KB

    if (stats.size > maxBytes) {
      throw new Error(
        `超出最大读取限制：文件 "${normalizedPath}" 大小为 ${stats.size} 字节，超过设定的最大限制 ${maxBytes} 字节。建议使用 sftp_download 将大文件直接下载到本地。`
      );
    }

    // 2. 读取文件 Buffer 并转换为指定编码字符
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      sftp.readFile(normalizedPath, (err, data) => {
        if (err) {
          return reject(new Error(`读取远程文件失败 (${normalizedPath}): ${err.message}`));
        }
        resolve(data);
      });
    });

    const encoding = params.encoding ?? "utf-8";
    return {
      content: buffer.toString(encoding),
      bytesRead: stats.size,
    };
  }

  /**
   * 写入并覆盖远程文本文件
   *
   * @param params 写入入参
   * @return 是否成功及写入的字节数
   * @throws 写入或目录创建失败时抛出异常
   */
  public async writeFile(
    params: SFTPWriteFileParams
  ): Promise<{ success: boolean; bytesWritten: number }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);

    // 1. 若配置自动创建父级目录，先确保其父级目录就绪
    if (params.createDirectories !== false) {
      const parentDir = path.posix.dirname(normalizedPath);
      if (parentDir && parentDir !== "/" && parentDir !== ".") {
        await this.ensureDir(sftp, parentDir);
      }
    }

    // 2. 写入文本数据
    const contentBuffer = Buffer.from(params.content, "utf-8");
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(normalizedPath, contentBuffer, (err) => {
        if (err) {
          return reject(new Error(`写入远程文件失败 (${normalizedPath}): ${err.message}`));
        }
        resolve();
      });
    });

    return {
      success: true,
      bytesWritten: contentBuffer.length,
    };
  }

  /**
   * 列出指定远程目录下的条目及其元数据
   *
   * @param params 浏览目录入参
   * @return 目录 POSIX 路径及其条目列表
   * @throws 目录不存在或无读取权限时抛出异常
   */
  public async listDir(
    params: SFTPListDirParams
  ): Promise<{ path: string; items: SFTPItem[] }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);

    const rawEntries = await new Promise<any[]>((resolve, reject) => {
      sftp.readdir(normalizedPath, (err, list) => {
        if (err) {
          return reject(new Error(`无法读取远程目录 (${normalizedPath}): ${err.message}`));
        }
        resolve(list ?? []);
      });
    });

    // 过滤掉 '.' 与 '..'
    const items: SFTPItem[] = rawEntries
      .filter((entry) => entry.filename !== "." && entry.filename !== "..")
      .map((entry) => this.toSFTPItem(entry.filename, entry.attrs));

    return {
      path: normalizedPath,
      items,
    };
  }

  /**
   * 获取远程文件或目录的元数据
   *
   * @param params 查询状态入参
   * @return POSIX 元数据对象
   * @throws 目标不存在或无权限时抛出异常
   */
  public async stat(
    params: SFTPStatParams
  ): Promise<{ stat: SFTPItem }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);
    const stats = await this.statInternal(sftp, normalizedPath);

    const name = path.posix.basename(normalizedPath) || normalizedPath;
    const item = this.toSFTPItem(name, stats);

    return { stat: item };
  }

  /**
   * 创建远程目录
   *
   * @param params 创建目录入参
   * @return 是否创建成功与归一化路径
   * @throws 创建失败时抛出异常
   */
  public async mkdir(
    params: SFTPMkdirParams
  ): Promise<{ created: boolean; path: string }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);

    if (params.recursive !== false) {
      await this.ensureDir(sftp, normalizedPath);
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.mkdir(normalizedPath, (err) => {
          if (err) {
            return reject(new Error(`创建目录失败 (${normalizedPath}): ${err.message}`));
          }
          resolve();
        });
      });
    }

    return {
      created: true,
      path: normalizedPath,
    };
  }

  /**
   * 删除远程文件或目录
   *
   * @param params 删除入参
   * @return 是否成功及删除路径
   * @throws 目标不存在或无权限删除时抛出异常
   */
  public async remove(
    params: SFTPRemoveParams
  ): Promise<{ removed: boolean; path: string }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedPath = path.posix.normalize(params.remotePath);

    if (params.recursive) {
      await this.removeRecursive(sftp, normalizedPath, 0, 10);
    } else {
      // 优先检查目标是文件还是目录
      let isDir = false;
      try {
        const stats = await this.statInternal(sftp, normalizedPath);
        isDir = typeof stats.isDirectory === "function" ? stats.isDirectory() : false;
      } catch {}

      if (isDir) {
        await new Promise<void>((resolve, reject) => {
          sftp.rmdir(normalizedPath, (err) => {
            if (err) {
              return reject(new Error(`删除远程目录失败 (${normalizedPath}): ${err.message}`));
            }
            resolve();
          });
        });
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.unlink(normalizedPath, (err) => {
            if (err) {
              return reject(new Error(`删除远程文件失败 (${normalizedPath}): ${err.message}`));
            }
            resolve();
          });
        });
      }
    }

    return {
      removed: true,
      path: normalizedPath,
    };
  }

  /**
   * 将本地文件上传到远程服务器
   *
   * @param params 上传参数
   * @return 上传结果及本地/远程路径
   * @throws 本地文件缺失或传输中断时抛出异常
   */
  public async upload(
    params: SFTPUploadParams
  ): Promise<{ success: boolean; localPath: string; remotePath: string }> {
    if (!fs.existsSync(params.localPath)) {
      throw new Error(`本地文件不存在: ${params.localPath}`);
    }

    const sftp = await this.getSFTP(params.connectionId);
    const normalizedRemotePath = path.posix.normalize(params.remotePath);

    // 确保远程父目录存在
    const parentDir = path.posix.dirname(normalizedRemotePath);
    if (parentDir && parentDir !== "/" && parentDir !== ".") {
      await this.ensureDir(sftp, parentDir);
    }

    await new Promise<void>((resolve, reject) => {
      sftp.fastPut(params.localPath, normalizedRemotePath, (err) => {
        if (err) {
          return reject(new Error(`上传文件失败 (${params.localPath} -> ${normalizedRemotePath}): ${err.message}`));
        }
        resolve();
      });
    });

    return {
      success: true,
      localPath: params.localPath,
      remotePath: normalizedRemotePath,
    };
  }

  /**
   * 从远程主机下载文件到本地
   *
   * @param params 下载参数
   * @return 下载结果及远程/本地路径
   * @throws 远程文件缺失或保存失败时抛出异常
   */
  public async download(
    params: SFTPDownloadParams
  ): Promise<{ success: boolean; remotePath: string; localPath: string }> {
    const sftp = await this.getSFTP(params.connectionId);
    const normalizedRemotePath = path.posix.normalize(params.remotePath);

    // 确保本地目录存在
    const localDir = path.dirname(params.localPath);
    if (!fs.existsSync(localDir)) {
      fs.mkdirSync(localDir, { recursive: true });
    }

    await new Promise<void>((resolve, reject) => {
      sftp.fastGet(normalizedRemotePath, params.localPath, (err) => {
        if (err) {
          return reject(new Error(`下载文件失败 (${normalizedRemotePath} -> ${params.localPath}): ${err.message}`));
        }
        resolve();
      });
    });

    return {
      success: true,
      remotePath: normalizedRemotePath,
      localPath: params.localPath,
    };
  }

  /**
   * 对远程文本文件实施精准锚点差异补丁更新
   *
   * @param params 差异补丁入参
   * @return 补丁执行结果及变更统计
   * @throws 目标文本未匹配或匹配多处时抛出异常
   */
  public async patchFile(
    params: SFTPPatchFileParams
  ): Promise<{
    success: boolean;
    remotePath: string;
    matchesReplaced: number;
    bytesBefore: number;
    bytesAfter: number;
  }> {
    const normalizedPath = path.posix.normalize(params.remotePath);

    // 1. 读取原文件内容
    const { content: originalContent, bytesRead: bytesBefore } = await this.readFile({
      remotePath: normalizedPath,
      connectionId: params.connectionId,
      encoding: "utf-8",
      maxBytes: 524288,
    });

    // 2. 检查待替换文本块
    if (!originalContent.includes(params.targetContent)) {
      throw new Error(
        `补丁失败：待替换的目标文本块未在远程文件 "${normalizedPath}" 中找到。请确保目标文本完全一致（包含换行与缩进空格）。`
      );
    }

    const occurrences = originalContent.split(params.targetContent).length - 1;
    if (occurrences > 1 && !params.allowMultiple) {
      throw new Error(
        `补丁失败：目标文本块在远程文件 "${normalizedPath}" 中匹配到了 ${occurrences} 处。为防止误伤，请包含更多上下文行以确保唯一定位，或显式传入 allowMultiple: true。`
      );
    }

    // 3. 执行替换（使用函数返回值替换以防止 $ 字符被正则引擎误展开）
    let newContent: string;
    if (params.allowMultiple) {
      newContent = originalContent.replaceAll(params.targetContent, () => params.replacementContent);
    } else {
      newContent = originalContent.replace(params.targetContent, () => params.replacementContent);
    }

    // 4. 回写文件
    const { bytesWritten: bytesAfter } = await this.writeFile({
      remotePath: normalizedPath,
      content: newContent,
      connectionId: params.connectionId,
      createDirectories: false,
    });

    return {
      success: true,
      remotePath: normalizedPath,
      matchesReplaced: params.allowMultiple ? occurrences : 1,
      bytesBefore,
      bytesAfter,
    };
  }

  /**
   * 将本地目录树通过纯 JS 流式 Tar 打包流式上传解压至远程主机
   *
   * @param params 目录上传入参
   * @return 上传结果及归档统计
   * @throws 本地目录不存在或远程解包失败时抛出异常
   */
  public async uploadDir(
    params: SFTPUploadDirParams
  ): Promise<{
    success: boolean;
    localPath: string;
    remotePath: string;
    totalFiles: number;
    totalBytes: number;
  }> {
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      throw new Error(`未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})`);
    }

    if (!fs.existsSync(params.localPath) || !fs.statSync(params.localPath).isDirectory()) {
      throw new Error(`本地目录不存在或不是有效目录: ${params.localPath}`);
    }

    const normalizedRemotePath = path.posix.normalize(params.remotePath);
    const escapedRemote = normalizedRemotePath.replace(/'/g, "'\\''");

    const pack = tar.pack();
    let totalFiles = 0;
    let totalBytes = 0;

    const walkDir = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir);
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry);
        const stat = fs.statSync(fullPath);
        const relPath = path.relative(params.localPath, fullPath).replace(/\\/g, "/");

        if (stat.isDirectory()) {
          pack.entry({ name: relPath, type: "directory", mode: stat.mode });
          walkDir(fullPath);
        } else if (stat.isFile()) {
          totalFiles++;
          totalBytes += stat.size;
          const content = fs.readFileSync(fullPath);
          pack.entry({ name: relPath, size: stat.size, mode: stat.mode, mtime: stat.mtime }, content);
        }
      }
    };

    walkDir(params.localPath);
    pack.finalize();

    const gzip = zlib.createGzip();
    const remoteCmd = `mkdir -p '${escapedRemote}' && tar -xzf - -C '${escapedRemote}'`;

    await new Promise<void>((resolve, reject) => {
      conn.client.exec(remoteCmd, (err, stream) => {
        if (err) {
          return reject(new Error(`创建远程解压通道失败: ${err.message}`));
        }

        let stderrOutput = "";
        stream.stderr.on("data", (chunk: Buffer) => {
          stderrOutput += chunk.toString("utf-8");
        });

        let exitCode: number | undefined;
        stream.on("exit", (code: number) => {
          exitCode = code;
        });

        stream.on("close", (code?: number) => {
          const finalCode = code ?? exitCode ?? 0;
          if (finalCode === 0) {
            resolve();
          } else {
            reject(new Error(`远程目录解包失败 (退出码 ${finalCode}): ${stderrOutput}`));
          }
        });

        pack.pipe(gzip).pipe(stream);
      });
    });

    return {
      success: true,
      localPath: params.localPath,
      remotePath: normalizedRemotePath,
      totalFiles,
      totalBytes,
    };
  }

  /**
   * 将远程目录通过流式 Tar 打包并在本地流式解压下载
   *
   * @param params 目录下载入参
   * @return 下载解压统计结果
   * @throws 远程打包失败或本地写入失败时抛出异常
   */
  public async downloadDir(
    params: SFTPDownloadDirParams
  ): Promise<{
    success: boolean;
    remotePath: string;
    localPath: string;
  }> {
    const conn = this.connectionPool.getConnection(params.connectionId);
    if (!conn) {
      throw new Error(`未找到可用的 SSH 连接 (${params.connectionId || "默认连接"})`);
    }

    const normalizedRemotePath = path.posix.normalize(params.remotePath);
    const escapedRemote = normalizedRemotePath.replace(/'/g, "'\\''");

    if (!fs.existsSync(params.localPath)) {
      fs.mkdirSync(params.localPath, { recursive: true });
    }

    const remoteCmd = `tar -czf - -C '${escapedRemote}' .`;

    await new Promise<void>((resolve, reject) => {
      conn.client.exec(remoteCmd, (err, stream) => {
        if (err) {
          return reject(new Error(`创建远程打包下载通道失败: ${err.message}`));
        }

        const gunzip = zlib.createGunzip();
        const extract = tar.extract();
        let isSettled = false;

        const onError = (error: Error) => {
          if (!isSettled) {
            isSettled = true;
            reject(error);
          }
        };

        let stderrOutput = "";
        stream.stderr.on("data", (chunk: Buffer) => {
          stderrOutput += chunk.toString("utf-8");
        });

        let exitCode: number | undefined;
        stream.on("exit", (code: number) => {
          exitCode = code;
        });

        stream.on("close", (code?: number) => {
          const finalCode = code ?? exitCode ?? 0;
          if (finalCode !== 0 && !isSettled) {
            isSettled = true;
            reject(new Error(`远程目录打包下载失败 (退出码 ${finalCode}): ${stderrOutput}`));
          }
        });

        gunzip.on("error", onError);
        extract.on("error", onError);

        extract.on("entry", (header, entryStream, next) => {
          const destPath = path.join(params.localPath, header.name);
          if (header.type === "directory") {
            try {
              fs.mkdirSync(destPath, { recursive: true });
              entryStream.resume();
              entryStream.on("end", next);
            } catch (err: any) {
              next(err);
            }
          } else {
            try {
              fs.mkdirSync(path.dirname(destPath), { recursive: true });
              const writeStream = fs.createWriteStream(destPath);
              entryStream.pipe(writeStream);
              writeStream.on("finish", next);
              writeStream.on("error", next);
            } catch (err: any) {
              next(err);
            }
          }
        });

        extract.on("finish", () => {
          if (!isSettled) {
            isSettled = true;
            resolve();
          }
        });

        const stdoutStream = (stream as any).stdout ?? stream;
        stdoutStream.pipe(gunzip).pipe(extract);
      });
    });

    return {
      success: true,
      remotePath: normalizedRemotePath,
      localPath: params.localPath,
    };
  }


  /**
   * 获取并缓存复用指定连接的 SFTP 会话通道
   */
  private async getSFTP(connectionId?: string): Promise<SFTPWrapper> {
    const conn = this.connectionPool.getConnection(connectionId);
    if (!conn) {
      const lastErr = this.connectionPool.getLastConnectionError();
      const detail = lastErr ? `。最近一次尝试建连失败原因: ${lastErr}` : "";
      throw new Error(
        `未找到可用的 SSH 连接 (${connectionId || "默认连接"})${detail}，请先通过 ssh_connect 建立连接`
      );
    }

    const existingPromise = this.sftpSessions.get(conn.id);
    if (existingPromise) {
      return existingPromise;
    }

    const sftpPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      conn.client.sftp((err, sftp) => {
        if (err) {
          this.sftpSessions.delete(conn.id);
          return reject(new Error(`建立 SFTP 通道失败 (${conn.id}): ${err.message}`));
        }

        sftp.on("close", () => {
          this.sftpSessions.delete(conn.id);
        });
        sftp.on("end", () => {
          this.sftpSessions.delete(conn.id);
        });

        resolve(sftp);
      });
    });

    this.sftpSessions.set(conn.id, sftpPromise);
    return sftpPromise;
  }

  /**
   * 递归级联删除目录与文件（内置防环与深度限制）
   */
  private async removeRecursive(
    sftp: SFTPWrapper,
    remotePath: string,
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (depth > maxDepth) {
      throw new Error(`递归删除超出最大安全深度限制 (${maxDepth})，已终止以防潜在软链接循环或越界`);
    }

    let isDir = false;
    try {
      const stats = await this.statInternal(sftp, remotePath);
      isDir = typeof stats.isDirectory === "function" ? stats.isDirectory() : false;
    } catch {
      return;
    }

    if (isDir) {
      const entries = await new Promise<any[]>((resolve, reject) => {
        sftp.readdir(remotePath, (err, list) => {
          if (err) return reject(err);
          resolve(list ?? []);
        });
      });

      for (const item of entries) {
        if (item.filename === "." || item.filename === "..") continue;
        const childPath = path.posix.join(remotePath, item.filename);
        await this.removeRecursive(sftp, childPath, depth + 1, maxDepth);
      }

      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(remotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    }
  }

  /**
   * 逐级确保远程目录存在（类似 mkdir -p）
   */
  private async ensureDir(sftp: SFTPWrapper, dirPath: string): Promise<void> {
    const normalized = path.posix.normalize(dirPath);
    if (normalized === "/" || normalized === ".") return;

    const parts = normalized.split("/").filter(Boolean);
    let current = "";

    for (const part of parts) {
      current += "/" + part;
      try {
        const stats = await this.statInternal(sftp, current);
        if (typeof stats.isDirectory === "function" && !stats.isDirectory()) {
          throw new Error(`路径冲突: "${current}" 已存在但不是一个目录`);
        }
      } catch (err: any) {
        if (err.message && err.message.includes("路径冲突")) {
          throw err;
        }
        await new Promise<void>((resolve) => {
          sftp.mkdir(current, () => {
            resolve();
          });
        });
      }
    }
  }

  /**
   * 读取远程状态内部封装
   */
  private statInternal(sftp: SFTPWrapper, remotePath: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          return reject(new Error(`获取远程文件状态失败 (${remotePath}): ${err.message}`));
        }
        resolve(stats);
      });
    });
  }

  /**
   * 将原始 SFTP 状态转换为领域模型 SFTPItem
   */
  private toSFTPItem(filename: string, attrs: any): SFTPItem {
    const isDir = typeof attrs?.isDirectory === "function" ? attrs.isDirectory() : false;
    const isFile = typeof attrs?.isFile === "function" ? attrs.isFile() : false;
    const isSym = typeof attrs?.isSymbolicLink === "function" ? attrs.isSymbolicLink() : false;

    return {
      name: filename,
      size: attrs?.size ?? 0,
      modifyTime: (attrs?.mtime ?? 0) * 1000,
      accessTime: (attrs?.atime ?? 0) * 1000,
      isDirectory: isDir,
      isFile: isFile,
      isSymbolicLink: isSym,
      permissions: formatPermissions(attrs?.mode),
    };
  }
}
