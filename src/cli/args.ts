/**
 * CLI 命令行参数解析器
 *
 * 基于 Node.js 原生 util.parseArgs 实现长短标志强类型解析 (ADR-0013)
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { parseArgs } from "node:util";

/**
 * CLI 命令行选项模型
 */
export interface CLIOptions {
  /** 是否请求打印帮助文档 */
  help?: boolean;
  /** 是否请求打印版本号 */
  version?: boolean;
  /** 是否请求执行环境四维自检诊断 */
  doctor?: boolean;
  /** 自定义服务唯一名称标识 (ADR-0015) */
  serverName?: string;
  /** 注入大模型的系统级服务引导指示说明 (ADR-0015) */
  serverInstructions?: string;
}

/**
 * 校验并提取去除了首尾空白的字符串选项值
 *
 * @param value 原始输入值
 * @return 净化后的有效非空字符串，无输入或纯空白时返回 undefined
 */
function parseTrimmedString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed !== "" ? trimmed : undefined;
  }
  return undefined;
}

/**
 * 解析命令行参数列表
 *
 * @param args 原始命令行参数切片，缺省默认使用 process.argv.slice(2)
 * @return 结构化的 CLI 选项对象
 */
export function parseCLIArgs(args: string[] = process.argv.slice(2)): CLIOptions {
  try {
    const { values, positionals } = parseArgs({
      args,
      options: {
        help: {
          type: "boolean",
          short: "h",
        },
        version: {
          type: "boolean",
          short: "v",
        },
        doctor: {
          type: "boolean",
        },
        "server-name": {
          type: "string",
        },
        "server-instructions": {
          type: "string",
        },
      },
      strict: false,
      allowPositionals: true,
    });

    const firstPositional = positionals && positionals.length > 0 ? positionals[0]?.toLowerCase() : undefined;

    return {
      help: Boolean(values.help) || firstPositional === "help",
      version: Boolean(values.version) || firstPositional === "version",
      doctor: Boolean(values.doctor) || firstPositional === "doctor",
      serverName: parseTrimmedString(values["server-name"]),
      serverInstructions: parseTrimmedString(values["server-instructions"]),
    };
  } catch {
    return {};
  }
}

