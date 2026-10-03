/**
 * SFTP POSIX 文件系统管理数据模型与 Zod 校验契约
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { z } from "zod";

/**
 * 校验必须为以正斜杠开头的 POSIX 绝对路径
 */
const posixAbsolutePathSchema = z
  .string()
  .min(1, "路径不能为空")
  .refine((val) => val.startsWith("/"), {
    message: "远程路径必须为以正斜杠 ('/') 开头的 POSIX 绝对路径",
  });

/**
 * 读取远程文本文件入参 Schema
 */
export const SFTPReadFileParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("远程文件绝对路径（必须以 '/' 开头）"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
  encoding: z.enum(["utf-8", "ascii"]).default("utf-8").describe("文件文本解码字符集，默认 utf-8"),
  maxBytes: z.number().int().positive().default(524288).describe("最大读取字节数限制，默认 512KB (524288 字节)，超出则拦截并建议下载"),
});

export type SFTPReadFileParams = z.infer<typeof SFTPReadFileParamsSchema>;

/**
 * 写入远程文本文件入参 Schema
 */
export const SFTPWriteFileParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("远程文件绝对路径"),
  content: z.string().describe("待写入的文本内容"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
  createDirectories: z.boolean().default(true).describe("当远程父级目录不存在时是否自动递归创建，默认 true"),
});

export type SFTPWriteFileParams = z.infer<typeof SFTPWriteFileParamsSchema>;

/**
 * 浏览远程目录入参 Schema
 */
export const SFTPListDirParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("待浏览的远程目录绝对路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SFTPListDirParams = z.infer<typeof SFTPListDirParamsSchema>;

/**
 * 获取远程文件或目录状态入参 Schema
 */
export const SFTPStatParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("待检查状态的远程路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SFTPStatParams = z.infer<typeof SFTPStatParamsSchema>;

/**
 * 创建远程目录入参 Schema
 */
export const SFTPMkdirParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("待创建的远程目录绝对路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
  recursive: z.boolean().default(true).describe("是否类似 'mkdir -p' 递归创建上级目录，默认 true"),
});

export type SFTPMkdirParams = z.infer<typeof SFTPMkdirParamsSchema>;

/**
 * 删除远程文件或目录入参 Schema
 */
export const SFTPRemoveParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("待删除的远程文件或目录绝对路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
  recursive: z.boolean().default(false).describe("若为目录且非空，是否级联递归删除，默认 false（防止误删）"),
});

export type SFTPRemoveParams = z.infer<typeof SFTPRemoveParamsSchema>;

/**
 * 本地文件上传到远程入参 Schema
 */
export const SFTPUploadParamsSchema = z.object({
  localPath: z.string().min(1, "本地文件路径不能为空").describe("宿主机本地文件的绝对路径"),
  remotePath: posixAbsolutePathSchema.describe("上传到远程主机的绝对目标路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SFTPUploadParams = z.infer<typeof SFTPUploadParamsSchema>;

/**
 * 远程文件下载到本地入参 Schema
 */
export const SFTPDownloadParamsSchema = z.object({
  remotePath: posixAbsolutePathSchema.describe("待下载的远程主机文件绝对路径"),
  localPath: z.string().min(1, "本地保存路径不能为空").describe("保存到宿主机本地的绝对路径"),
  connectionId: z.string().optional().describe("目标连接标识符，缺省时使用当前默认连接"),
});

export type SFTPDownloadParams = z.infer<typeof SFTPDownloadParamsSchema>;

/**
 * POSIX 文件与目录元数据模型 Schema
 */
export const SFTPItemSchema = z.object({
  name: z.string().describe("文件或目录名称"),
  size: z.number().describe("字节大小"),
  modifyTime: z.number().describe("最后修改时间戳（毫秒）"),
  accessTime: z.number().describe("最后访问时间戳（毫秒）"),
  isDirectory: z.boolean().describe("是否为目录"),
  isFile: z.boolean().describe("是否为普通文件"),
  isSymbolicLink: z.boolean().describe("是否为符号软链接"),
  permissions: z.string().describe("POSIX 权限字符（例如 rwxr-xr-x 或 0755）"),
});

export type SFTPItem = z.infer<typeof SFTPItemSchema>;
