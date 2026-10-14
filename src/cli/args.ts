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
  help?: boolean;
  version?: boolean;
  doctor?: boolean;
}

/**
 * 解析命令行参数列表
 *
 * @param args 原始命令行参数切片，缺省默认使用 process.argv.slice(2)
 * @return 结构化的 CLI 选项对象
 */
export function parseCLIArgs(args: string[] = process.argv.slice(2)): CLIOptions {
  try {
    const { values } = parseArgs({
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
      },
      strict: false,
      allowPositionals: true,
    });

    return {
      help: Boolean(values.help),
      version: Boolean(values.version),
      doctor: Boolean(values.doctor),
    };
  } catch {
    return {};
  }
}
