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
 * 判断指定主机地址是否属于本地回环地址 (ADR-0017)
 *
 * @param host 待检测主机地址
 * @return 属于回环地址时返回 true，否则返回 false
 */
export function isLoopbackHost(host: string): boolean {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "localhost" || trimmed === "::1" || trimmed === "[::1]") {
    return true;
  }
  if (trimmed.startsWith("127.")) {
    const parts = trimmed.split(".");
    if (
      parts.length === 4 &&
      parts.every((p) => {
        const n = Number.parseInt(p, 10);
        return !Number.isNaN(n) && n >= 0 && n <= 255;
      })
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 校验网络服务绑定安全性，非回环外部暴露且未配置 Token 时立即触发熔断异常 (ADR-0017)
 *
 * @param host 服务监听地址
 * @param authToken 可选的身份鉴权令牌
 * @throws 当外部网络暴露且无 Token 时抛出安全熔断致命异常
 */
export function assertFailClosedBinding(host: string, authToken?: string): void {
  if (!isLoopbackHost(host) && !authToken) {
    throw new Error(
      `[mcp-server-ssh] 安全熔断: 外部网络绑定 (${host}) 必须配置 MCP_SSH_AUTH_TOKEN (Fail-Closed)`
    );
  }
}

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

  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return (ipInt & mask) === (networkInt & mask);
}

/**
 * 将 IPv6 地址转换为 128 位无符号 BigInt
 *
 * @param ip IPv6 字符串
 * @return 128 位大整数，格式非法时返回 null
 */
function ipv6ToBigInt(ip: string): bigint | null {
  const cleaned = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
  if (net.isIP(cleaned) !== 6) {
    return null;
  }

  let full = cleaned;
  if (full.includes("::")) {
    const parts = full.split("::");
    const left = parts[0] ? parts[0].split(":") : [];
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    const zeros = Array(missing).fill("0");
    full = [...left, ...zeros, ...right].join(":");
  }

  const blocks = full.split(":");
  if (blocks.length !== 8) {
    return null;
  }

  let res = 0n;
  for (const b of blocks) {
    const val = BigInt(Number.parseInt(b || "0", 16));
    res = (res << 16n) | val;
  }
  return res;
}

/**
 * 校验指定 IPv6 是否匹配 IPv6 CIDR 网段 (ADR-0017)
 *
 * @param ip 目标 IPv6 字符串
 * @param cidr IPv6 CIDR 网段定义 (如 2001:db8::/32)
 * @return 匹配命中返回 true，否则返回 false
 */
function matchIpv6Cidr(ip: string, cidr: string): boolean {
  const [network, prefixStr] = cidr.split("/");
  if (!network || !prefixStr) {
    return false;
  }
  const prefix = Number.parseInt(prefixStr, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 128) {
    return false;
  }

  const ipBig = ipv6ToBigInt(ip);
  const netBig = ipv6ToBigInt(network);
  if (ipBig === null || netBig === null) {
    return false;
  }

  const mask = prefix === 0 ? 0n : ((~0n) << BigInt(128 - prefix)) & ((1n << 128n) - 1n);
  return (ipBig & mask) === (netBig & mask);
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
 * 解析并解构带端口或方括号的标准目标主机与端口
 *
 * 支持:
 * - 纯域名或 IPv4: "192.168.1.1", "example.com"
 * - 带端口 IPv4/域名: "192.168.1.1:2222", "db.internal:3306"
 * - 带端口 IPv6: "[2001:db8::1]:2222", "[::1]:8080"
 * - 纯 IPv6: "::1", "2001:db8::1"
 *
 * @param target 原始目标字符串
 * @return 结构化的 host 与可选端口
 */
export function parseHostPort(target: string): { host: string; port?: number } {
  const trimmed = target.trim();
  if (trimmed.startsWith("[")) {
    const closingBracket = trimmed.indexOf("]");
    if (closingBracket > 0) {
      const host = trimmed.slice(1, closingBracket);
      const rest = trimmed.slice(closingBracket + 1);
      if (rest.startsWith(":")) {
        const port = Number.parseInt(rest.slice(1), 10);
        return { host, port: Number.isNaN(port) ? undefined : port };
      }
      return { host };
    }
  }

  const lastColonIndex = trimmed.lastIndexOf(":");
  if (lastColonIndex > 0) {
    const possiblePortStr = trimmed.slice(lastColonIndex + 1);
    const parsedPort = Number.parseInt(possiblePortStr, 10);
    // 排除纯 IPv6 (含有多个冒号)
    if (!Number.isNaN(parsedPort) && parsedPort >= 1 && parsedPort <= 65535 && !trimmed.includes("::")) {
      return { host: trimmed.slice(0, lastColonIndex), port: parsedPort };
    }
  }

  return { host: trimmed };
}

/**
 * 匹配单条白名单规则 (支持 IPv4/IPv6、CIDR 网段、域名通配符及端口约束)
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

  // 1. 如果规则是 CIDR 网段 (支持带可选端口如 10.0.0.0/8:2222)
  if (trimmedRule.includes("/")) {
    let cidr = trimmedRule;
    let requiredPort: number | undefined;

    const colonIndex = trimmedRule.lastIndexOf(":");
    if (colonIndex > trimmedRule.indexOf("/")) {
      const p = Number.parseInt(trimmedRule.slice(colonIndex + 1), 10);
      if (!Number.isNaN(p)) {
        cidr = trimmedRule.slice(0, colonIndex);
        requiredPort = p;
      }
    }

    if (requiredPort !== undefined && requiredPort !== port) {
      return false;
    }

    if (matchIpv4Cidr(host, cidr)) {
      return true;
    }
    if (matchIpv6Cidr(host, cidr)) {
      return true;
    }
    return false;
  }

  // 2. 普通 IP 或域名 (支持 IPv6 [::1]:2222 与普通 host:port)
  const { host: ruleHost, port: rulePort } = parseHostPort(trimmedRule);

  if (rulePort !== undefined && rulePort !== port) {
    return false;
  }

  // 3. 比较 IP (针对 IPv6 标准化比较)
  if (net.isIP(host) === 6 && net.isIP(ruleHost) === 6) {
    const ipA = ipv6ToBigInt(host);
    const ipB = ipv6ToBigInt(ruleHost);
    return ipA !== null && ipB !== null && ipA === ipB;
  }

  // 4. IP 或域名/通配符匹配
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
export function parseJumpTarget(jumpHost: { host: string; port?: number } | string): { host: string; port: number } {
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

  const parsed = parseHostPort(cleaned);
  return {
    host: parsed.host,
    port: parsed.port ?? 22,
  };
}

/**
 * 校验选项契约
 */
export interface ConnectionTargetValidationOptions {
  /** 允许的目标白名单规则 */
  allowedTargets?: string[];
  /** 是否禁用动态建连 */
  disableDynamicConnect?: boolean;
  /** 是否通过合法的本地 OpenSSH Config 别名建连 (ADR-0017 放行豁免) */
  isConfigAlias?: boolean;
}

/**
 * 校验出站连接目标合法性，阻止未授权动态建连与跳板渗透
 *
 * @param targetHost 目标主机
 * @param targetPort 目标端口
 * @param jumpHost 可选的 ProxyJump 跳板机
 * @param options 安全配置选项
 * @throws 当建连被管理员禁用或未命中目标白名单时抛出异常
 */
export function validateConnectionTarget(
  targetHost: string,
  targetPort = 22,
  jumpHost?: { host: string; port?: number } | string,
  options?: ConnectionTargetValidationOptions
): void {
  // 1. 动态建连总开关守卫拦截 (ADR-0017: 仅允许本地 ~/.ssh/config 既有别名或预建连)
  if (options?.disableDynamicConnect === true && !options?.isConfigAlias) {
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
