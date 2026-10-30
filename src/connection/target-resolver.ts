/**
 * 多主机目标选择器解析引擎 (Target Resolver)
 *
 * 支持展开预设宏（@all_active、@all_configured）、通配符模式（如 web-*）及显式目标标识，并保持首次命中顺序自动去重
 *
 * @author Ateng
 * @since 2026-10-30
 */

import type { SSHListTargetsResult } from "../types/connection.js";
import type { SSHConfigParser } from "./config-parser.js";
import type { ConnectionPool } from "./pool.js";

/**
 * 常用目标选择器宏定义
 */
export const TARGET_MACRO_ALL_ACTIVE = "@all_active";
export const TARGET_MACRO_ALL_CONFIGURED = "@all_configured";

/**
 * 目标解析器初始化依赖选项
 */
export interface TargetResolverOptions {
  /** 连接池实例（用于读取活跃连接 ID） */
  connectionPool: ConnectionPool;
  /** SSH 配置文件解析器实例（用于读取预设主机别名） */
  configParser: SSHConfigParser;
}

/**
 * 多主机目标选择器解析器
 */
export class TargetResolver {
  private readonly connectionPool: ConnectionPool;
  private readonly configParser: SSHConfigParser;

  /**
   * 构造目标解析器实例
   *
   * @param options 依赖的连接池与配置解析器
   */
  public constructor(options: TargetResolverOptions) {
    this.connectionPool = options.connectionPool;
    this.configParser = options.configParser;
  }

  /**
   * 将输入的目标选择器表达式列表展开为去重后的目标标识列表
   *
   * @param selectors 目标表达式数组（支持 @all_active、@all_configured、通配符如 web-*、显式别名或连接 ID）
   * @return 按首次解析顺序去重后的目标标识数组（无匹配时返回空数组）
   */
  public resolve(selectors: string[]): string[] {
    if (!Array.isArray(selectors) || selectors.length === 0) {
      return [];
    }

    const activeIds = this.connectionPool
      .listConnections()
      .map((conn) => conn.connectionId);
    const configuredAliases = this.configParser
      .listHosts()
      .map((host) => host.alias);

    const resolvedSet = new Set<string>();

    // 1. 逐项解析宏、通配符与显式目标标识
    for (const rawSelector of selectors) {
      const selector = rawSelector.trim();
      if (!selector) {
        continue;
      }

      if (selector === TARGET_MACRO_ALL_ACTIVE) {
        for (const id of activeIds) {
          resolvedSet.add(id);
        }
        continue;
      }

      if (selector === TARGET_MACRO_ALL_CONFIGURED) {
        for (const alias of configuredAliases) {
          resolvedSet.add(alias);
        }
        continue;
      }

      // 2. 通配符模式匹配（包含 * 或 ?）
      if (selector.includes("*") || selector.includes("?")) {
        const regex = this.globToRegExp(selector);
        for (const alias of configuredAliases) {
          if (regex.test(alias)) {
            resolvedSet.add(alias);
          }
        }
        for (const id of activeIds) {
          if (regex.test(id)) {
            resolvedSet.add(id);
          }
        }
        continue;
      }

      // 3. 显式目标标识（连接 ID 或主机别名）
      resolvedSet.add(selector);
    }

    return Array.from(resolvedSet);
  }

  /**
   * 聚合生成统一目标发现视图（整合活跃连接、本地预设主机状态与熔断记录）
   *
   * @return 统一目标发现结构化结果
   */
  public discoverTargets(): SSHListTargetsResult {
    const activeConnections = this.connectionPool.listConnections();
    const failedTargets = this.connectionPool.listFailedTargets();
    const rawConfiguredHosts = this.configParser.listHosts();

    const configuredHosts = rawConfiguredHosts.map((host) => {
      const matchedActive = activeConnections.find(
        (conn) =>
          conn.connectionId === host.alias ||
          (host.hostName &&
            conn.host === host.hostName &&
            conn.port === (host.port ?? 22))
      );
      if (matchedActive) {
        return {
          ...host,
          status: "connected" as const,
          connectionId: matchedActive.connectionId,
        };
      }

      const matchedFailed = failedTargets.find(
        (failed) =>
          failed.targetId === host.alias ||
          (host.hostName &&
            failed.targetId === `${host.hostName}:${host.port ?? 22}`)
      );
      if (matchedFailed) {
        return {
          ...host,
          status:
            matchedFailed.state === "open"
              ? ("cooldown" as const)
              : ("half_open" as const),
          lastError: matchedFailed.lastError,
        };
      }

      return {
        ...host,
        status: "disconnected" as const,
      };
    });

    return {
      totalActive: activeConnections.length,
      totalConfigured: configuredHosts.length,
      totalFailed: failedTargets.length,
      activeConnections,
      configuredHosts,
      failedTargets,
    };
  }

  /**
   * 将轻量通配符表达式（* 与 ?）转换为精确边界正则表达式
   */
  private globToRegExp(glob: string): RegExp {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
    return new RegExp(`^${escaped}$`);
  }
}
