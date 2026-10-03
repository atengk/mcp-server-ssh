/**
 * 远程高危命令安全防御拦截守卫
 *
 * @author Ateng
 * @since 2026-10-03
 */

import type { SafetyCheckResult, SafetyRule } from "../types/security.js";

/**
 * 内置的致命破坏性命令拦截规则清单
 */
const BUILTIN_LETHAL_RULES: SafetyRule[] = [
  {
    id: "lethal-rm-root",
    name: "禁止递归强制删除根目录或当前目录",
    description: "命令包含针对系统根目录 (/)、根通配符 (/*) 或当前目录 (.) 的强制递归删除 (rm -rf)，将导致全盘数据被清空。",
    pattern:
      "(?:sudo\\s+)?rm\\s+-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\\s+(?:--no-preserve-root\\s+)?(?:/|/\\*|/var/\\.\\.|\\.)(?:\\s+--no-preserve-root)?(?:\\s+.*)?$|(?:sudo\\s+)?rm\\s+-[a-zA-Z]*f[a-zA-Z]*r[a-zA-Z]*\\s+(?:--no-preserve-root\\s+)?(?:/|/\\*|/var/\\.\\.|\\.)(?:\\s+--no-preserve-root)?(?:\\s+.*)?$|(?:sudo\\s+)?rm\\s+(?:--no-preserve-root\\s+)-[a-zA-Z]*r[a-zA-Z]*f[a-zA-Z]*\\s+(?:/|/\\*|/var/\\.\\.|\\.)(?:\\s+.*)?$",
    severity: "critical",
    enabled: true,
  },
  {
    id: "lethal-mkfs",
    name: "禁止块设备格式化",
    description: "命令尝试直接对底层磁盘块设备执行 mkfs 格式化，将导致设备文件系统被彻底覆写。",
    pattern: "(?:sudo\\s+)?mkfs(?:\\.[a-z0-9]+)?\\s+/dev/(?:sd[a-z]|nvme|vd[a-z]|hd[a-z])",
    severity: "critical",
    enabled: true,
  },
  {
    id: "lethal-dd-disk",
    name: "禁止底层磁盘覆写",
    description: "命令使用 dd 绕过文件系统直接向磁盘设备写入原始数据，将破坏分区表与关键数据。",
    pattern: "(?:sudo\\s+)?dd\\s+.*of=/dev/(?:sd[a-z]|nvme|vd[a-z]|hd[a-z])",
    severity: "critical",
    enabled: true,
  },
  {
    id: "lethal-overwrite-dev",
    name: "禁止重定向清空磁盘设备",
    description: "命令通过 Shell 重定向符号尝试直接向物理/虚拟磁盘设备写入清空数据。",
    pattern: ">\\s*/dev/(?:sd[a-z]|nvme|vd[a-z]|hd[a-z])",
    severity: "critical",
    enabled: true,
  },
  {
    id: "shutdown-reboot",
    name: "禁止系统关机与重启",
    description: "命令将导致远程 Linux 系统停机、关机或重启，破坏服务可用性并中断 SSH 连接。",
    pattern:
      "^(?:sudo\\s+)?(?:shutdown(?:\\s+-[a-zA-Z]+)?(?:\\s+now)?|reboot|poweroff|halt|init\\s+[06])(?:\\s+.*)?$",
    severity: "critical",
    enabled: true,
  },
  {
    id: "fork-bomb",
    name: "禁止 Fork 炸弹攻击",
    description: "命令包含消耗内核全部 PID 与进程资源导致宕机的 Fork 炸弹代码。",
    pattern: ":\\s*\\(\\s*\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:",
    severity: "critical",
    enabled: true,
  },
  {
    id: "lethal-chmod-zero",
    name: "禁止清空系统根文件权限",
    description: "命令尝试清空根目录或全盘权限为 000，将直接导致整个系统所有应用和进程瘫痪。",
    pattern: "(?:sudo\\s+)?chmod\\s+(?:-[a-zA-Z]*R[a-zA-Z]*\\s+)?(?:000|0)\\s+(?:/|/\\*)",
    severity: "critical",
    enabled: true,
  },
];

/**
 * 安全守卫初始化选项
 */
export interface SafetyGuardOptions {
  extraRules?: SafetyRule[];
  whitelistPatterns?: string[];
}

/**
 * 高危命令安全防御守卫
 */
export class SafetyGuard {
  private rules: SafetyRule[] = [];
  private compiledRules: Array<{ rule: SafetyRule; regex: RegExp }> = [];
  private compiledWhitelists: RegExp[] = [];

  public constructor(options?: SafetyGuardOptions) {
    this.rules = [...BUILTIN_LETHAL_RULES, ...(options?.extraRules ?? [])];

    // 预编译全部黑名单正则提升匹配性能
    for (const rule of this.rules) {
      if (rule.enabled) {
        this.compiledRules.push({
          rule,
          regex: new RegExp(rule.pattern, "i"),
        });
      }
    }

    // 预编译白名单正则
    if (options?.whitelistPatterns) {
      for (const pattern of options.whitelistPatterns) {
        this.compiledWhitelists.push(new RegExp(pattern, "i"));
      }
    }
  }

  /**
   * 检验目标 Shell 命令的安全性
   *
   * @param command 待下发的原始命令行文本
   * @return 安全检查结果
   */
  public check(command: string): SafetyCheckResult {
    const trimmed = command.trim();
    if (!trimmed) {
      return { isAllowed: true };
    }

    // 1. 白名单优先校验：若显式匹配白名单则直接放行
    for (const whitelistRegex of this.compiledWhitelists) {
      if (whitelistRegex.test(trimmed)) {
        return {
          isAllowed: true,
          reason: "命令已匹配安全白名单放行规则",
        };
      }
    }

    // 2. 依次匹配黑名单致命规则
    for (const { rule, regex } of this.compiledRules) {
      if (regex.test(trimmed)) {
        return {
          isAllowed: false,
          matchedRule: rule,
          reason: `[MCP 安全守卫阻断] 命令触发高危拦截规则 [${rule.id}: ${rule.name}]：${rule.description}`,
        };
      }
    }

    return {
      isAllowed: true,
    };
  }

  /**
   * 断言命令安全；若触发致命规则则直接抛出语义化异常
   *
   * @param command 待检验的命令行
   * @throws 当命中高危拦截规则时抛出 Error
   */
  public assertSafe(command: string): void {
    const result = this.check(command);
    if (!result.isAllowed) {
      throw new Error(result.reason || "命令触发高危安全拦截，拒绝执行");
    }
  }
}
