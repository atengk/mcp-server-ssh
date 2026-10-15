/**
 * 目标主机白名单校验与动态建连安全守卫 (Target Allowlist & Dynamic Connect Guard)
 *
 * 实施出站连接目标约束与防内网横向中继跳板攻击 (ADR-0017)
 *
 * @author Ateng
 * @since 2026-10-15
 */

import net from "node:net";

/**
 * 将 IPv4 点分十进制字符串转换为 32 位无符号整数
 *
 * @param ip IPv4 字符串
 * @return 32 位无符号数值，非法时返回 null
 */
function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }
  let res = 0;
  for (const p of parts) {
    const n = Number.parseInt(p, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) {
      return null;
    }
    res = (res << 8) | n;
  }
  return res >>> 0;
}

/**
 * 校验指定 IPv4 是否匹配 CIDR 网段
 *
 * @param ip 目标 IPv4 字符串
 * @param cidr CIDR 格式网段定义 (如 10.0.0.0/8)
 * @return 匹配命中返回 true，否则返回 false
 */
function matchIpv4Cidr(ip: string, cidr: string): boolean {
  const [cidrIp, prefixStr] = cidr.split("/");
  if (!cidrIp || !prefixStr) {
    return false;
  }
  const prefix = Number.parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    return false;
  }

  const ipInt = ipv4ToInt(ip);
  const networkInt = ipv4ToInt(cidrIp);
  if (ipInt === null || networkInt === null) {
    return false;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (networkInt & mask);
}

/**
 * 校验目标主机名是否匹配域名规则或通配符
 *
 * @param host 待检测主机名
 * @param pattern 域名表达式 (如 *.internal.corp 或 myhost.local)
 * @return 命中返回 true，否则返回 false
 */
function matchDomain(host: string, pattern: string): boolean {
  const normalizedHost = host.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedHost.endsWith(suffix);
  }
  return normalizedHost === normalizedPattern;
}

/**
 * 匹配单条白名单规则 (支持 IP、CIDR、域名通配符及端口约束)
 *
 * @param host 目标主机名或 IP
 * @param port 目标端口
 * @param rule 单条白名单规则字符串
 * @return 命中返回 true，否则返回 false
 */
function matchRule(host: string, port: number, rule: string): boolean {
  const trimmedRule = rule.trim();
  if (!trimmedRule) {
    return false;
  }

  let ruleHost = trimmedRule;
  let rulePort: number | undefined;

  const lastColonIndex = trimmedRule.lastIndexOf(":");
  if (lastColonIndex > 0) {
    const possiblePortStr = trimmedRule.slice(lastColonIndex + 1);
    const parsedPort = Number.parseInt(possiblePortStr, 10);
    if (!Number.isNaN(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 && !trimmedRule.includes("::")) {
      ruleHost = trimmedRule.slice(0, lastColonIndex);
      rulePort = parsedPort;
    }
  }

  if (rulePort !== undefined && rulePort !== port) {
    return false;
  }

  // 1. CIDR 子网判定
  if (ruleHost.includes("/")) {
    if (matchIpv4Cidr(host, ruleHost)) {
      return true;
    }
    return false;
  }

  // 2. IP 或域名/通配符匹配
  if (matchDomain(host, ruleHost)) {
    return true;
  }

  return false;
}

/**
 * 评估目标主机与端口是否在允许的目标白名单范围内
 *
 * @param host 目标主机或 IP 地址
 * @param port 目标端口 (默认 22)
 * @param allowedTargets 允许的目标规则列表，未指定或为空时默认全量放行
 * @return 命中白名单规则时返回 true，否则返回 false
 */
export function isTargetAllowed(host: string, port = 22, allowedTargets?: string[]): boolean {
  if (!allowedTargets || allowedTargets.length === 0) {
    return true;
  }
  return allowedTargets.some((rule) => matchRule(host, port, rule));
}

/**
 * 提取并规范化跳板机 Host 与 Port
 *
 * @param jumpHost 跳板机字符串或结构体参数
 * @return 规范化后的 host 与 port
 */
function parseJumpTarget(jumpHost: { host: string; port?: number } | string): { host: string; port: number } {
  if (typeof jumpHost === "object" && jumpHost !== null) {
    return {
      host: jumpHost.host,
      port: jumpHost.port ?? 22,
    };
  }

  let cleaned = jumpHost.trim();
  if (cleaned.includes("@")) {
    cleaned = cleaned.slice(cleaned.indexOf("@") + 1);
  }

  let host = cleaned;
  let port = 22;
  const lastColon = cleaned.lastIndexOf(":");
  if (lastColon > 0) {
    const p = Number.parseInt(cleaned.slice(lastColon + 1), 10);
    if (!Number.isNaN(p)) {
      host = cleaned.slice(0, lastColon);
      port = p;
    }
  }
  return { host, port };
}

/**
 * 校验出站连接目标合法性，阻止未授权动态建连与跳板渗透
 *
 * @param targetHost 目标主机
 * @param targetPort 目标端口
 * @param jumpHost 可选的 ProxyJump 跳板机
 * @param options 安全配置选项 (allowedTargets, disableDynamicConnect)
 * @throws 当建连被管理员禁用或未命中目标白名单时抛出异常
 */
export function validateConnectionTarget(
  targetHost: string,
  targetPort = 22,
  jumpHost?: { host: string; port?: number } | string,
  options?: { allowedTargets?: string[]; disableDynamicConnect?: boolean }
): void {
  // 1. 动态建连总开关守卫拦截
  if (options?.disableDynamicConnect === true) {
    throw new Error(
      "[mcp-server-ssh] 安全拦截: 动态建连已被管理员禁用 (MCP_SSH_DISABLE_DYNAMIC_CONNECT=true)"
    );
  }

  // 2. 目标主机白名单守卫校验
  if (options?.allowedTargets && options.allowedTargets.length > 0) {
    if (!isTargetAllowed(targetHost, targetPort, options.allowedTargets)) {
      throw new Error(
        `[mcp-server-ssh] 安全拦截: 目标主机 ${targetHost}:${targetPort} 未包含在允许的目标白名单 (Target Allowlist) 中`
      );
    }

    // 3. 跳板机 (ProxyJump) 级联白名单守卫校验
    if (jumpHost) {
      const { host: jHost, port: jPort } = parseJumpTarget(jumpHost);
      if (!isTargetAllowed(jHost, jPort, options.allowedTargets)) {
        throw new Error(
          `[mcp-server-ssh] 安全拦截: 跳板机 (ProxyJump) ${jHost}:${jPort} 未包含在允许的目标白名单 (Target Allowlist) 中`
        );
      }
    }
  }
}
