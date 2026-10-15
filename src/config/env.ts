/**
 * 环境变量解析器与集中配置管理中枢 (12-Factor App)
 *
 * 实施严格单命名空间治理与非宽松类型校验 (ADR-0012)
 *
 * @author Ateng
 * @since 2026-10-04
 */

import { z } from "zod";
import type { ProxyJumpOptions, SSHConnectParams } from "../types/connection.js";

/**
 * 通信传输协议枚举
 */
export type TransportMode = "stdio" | "sse";

/**
 * 目标主机预建连配置契约
 */
export interface TargetHostConfig {
  host?: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sshConfigAlias?: string;
}

/**
 * 跳板机 / 堡垒机 (ProxyJump) 预配置契约
 */
export interface ProxyJumpConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

/**
 * 安全审计配置契约 (ADR-0014)
 */
export interface AuditConfig {
  /**
   * 是否启用安全审计轨迹记录
   */
  enabled: boolean;

  /**
   * 审计日志文件落盘路径 (未指定时输出至 stderr)
   */
  logPath?: string;

  /**
   * 单文件切分大小上限 (单位: MB)
   */
  maxSizeMb: number;

  /**
   * 保留的历史切分备份文件数
   */
  maxFiles: number;

  /**
   * 是否启用严格熔断模式 (Fail-Closed)
   */
  strict: boolean;
}


/**
 * 应用全局集中配置契约
 */
export interface AppConfig {
  transport: TransportMode;
  serverHost: string;
  serverPort: number;
  timeoutMs: number;
  keepAliveIntervalMs: number;
  allowDangerousCommands: boolean;
  target?: TargetHostConfig;
  proxyJump?: ProxyJumpConfig;
  audit: AuditConfig;
  /**
   * 服务唯一名称标识 (默认: "mcp-server-ssh")
   */
  serverName: string;
  /**
   * 服务引导指示自然语言说明 (缺省时为空)
   */
  serverInstructions?: string;
  /**
   * SSE 传输模式共享身份鉴权令牌 (ADR-0017)
   */
  authToken?: string;
}



/**
 * 从环境变量映射中提取严格规范的值
 *
 * 仅且严格读取 MCP_SSH_* 规范键名，不存在或为空白字符串时返回 undefined
 *
 * @param env 环境变量键值对
 * @param canonicalKey 官方标准主键名 (如 MCP_SSH_HOST)
 * @return 命中的非空字符串，未命中时返回 undefined
 */
function getEnvValue(env: NodeJS.ProcessEnv, canonicalKey: string): string | undefined {
  const canonical = env[canonicalKey];
  if (canonical !== undefined && canonical.trim() !== "") {
    return canonical.trim();
  }
  return undefined;
}

/**
 * 严格布尔值转换器 (Strict Configuration Guard)
 *
 * 仅且严格允许 "true" 或 "false"（忽略大小写与首尾空格），严禁 "1"、"yes"、"on" 等模糊宽松推断
 *
 * @param value 环境变量原始值
 * @param defaultValue 缺省默认值
 * @param fieldName 字段名称 (用于友好错误提示)
 * @return 解析后的布尔值
 * @throws 当输入非空且非严格 "true" / "false" 时抛出配置解析异常
 */
function parseBoolean(value: string | undefined, defaultValue: boolean, fieldName: string): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(
    `[mcp-server-ssh] 配置解析错误: ${fieldName} 必须为合法的布尔值 ("true" 或 "false")，收到无效输入 "${value}"`
  );
}

/**
 * 校验并解析有效网络端口号
 *
 * @param value 原始环境变量字符串
 * @param defaultPort 默认端口
 * @param fieldName 字段名称 (用于友好错误提示)
 * @return 解析后的 1~65535 整数端口
 * @throws 当端口非数字或超出有效区间时抛出异常
 */
function parsePort(value: string | undefined, defaultPort: number, fieldName: string): number {
  if (value === undefined) {
    return defaultPort;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`[mcp-server-ssh] 配置解析错误: ${fieldName} 必须为数字，收到无效的端口号 "${value}"`);
  }

  if (parsed < 1 || parsed > 65535) {
    throw new Error(`[mcp-server-ssh] 配置解析错误: ${fieldName} 端口号超出有效范围 (1-65535)，收到 "${value}"`);
  }

  return parsed;
}

/**
 * 校验并解析非负整数数值
 *
 * @param value 原始环境变量字符串
 * @param defaultValue 默认数值
 * @param fieldName 字段名称 (用于友好错误提示)
 * @param desc 可选的数值业务语义说明
 * @return 解析后的正整数
 * @throws 当数值非法或小于等于 0 时抛出异常
 */
function parsePositiveInt(

  value: string | undefined,
  defaultValue: number,
  fieldName: string,
  desc?: string
): number {
  if (value === undefined) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  const subject = desc ? `${desc}必须为正整数` : "必须为正整数";
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new Error(`[mcp-server-ssh] 配置解析错误: ${fieldName} ${subject}，收到 "${value}"`);
  }

  return parsed;
}


/**
 * 提取并规范化私钥凭证输入 (仅支持 MCP_SSH_PRIVATE_KEY_BASE64, MCP_SSH_PRIVATE_KEY, MCP_SSH_PRIVATE_KEY_PATH)
 *
 * @param env 环境变量字典
 * @param isProxy 是否提取跳板机私钥
 * @return 规范化后的私钥内容或文件路径
 */
function resolvePrivateKey(env: NodeJS.ProcessEnv, isProxy = false): string | undefined {
  const prefix = isProxy ? "MCP_SSH_PROXY_" : "MCP_SSH_";

  // 1. 优先级最高：Base64 编码的私钥字符串
  const base64Key = getEnvValue(env, `${prefix}PRIVATE_KEY_BASE64`);
  if (base64Key) {
    try {
      return Buffer.from(base64Key, "base64").toString("utf-8");
    } catch (err) {
      throw new Error(
        `[mcp-server-ssh] 配置解析错误: ${prefix}PRIVATE_KEY_BASE64 无法进行 Base64 解码: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  // 2. 优先级次高：PEM 私钥多行文本 (还原可能被环境转义的 \\n)
  const rawKey = getEnvValue(env, `${prefix}PRIVATE_KEY`);
  if (rawKey) {
    return rawKey.replace(/\\n/g, "\n");
  }

  // 3. 优先级第三：私钥本地文件路径 (排他性规范锁定为 PRIVATE_KEY_PATH)
  return getEnvValue(env, `${prefix}PRIVATE_KEY_PATH`);
}

/**
 * 解析并生成全局类型化应用配置
 *
 * @param env 输入的环境变量字典，缺省默认使用当前 process.env
 * @return 结构完整且经过强校验的 AppConfig 对象
 */
export function parseEnv(env: NodeJS.ProcessEnv = process.env): AppConfig {
  // 1. 通信协议与服务监听
  const transportRaw = getEnvValue(env, "MCP_SSH_TRANSPORT")?.toLowerCase();
  let transport: TransportMode = "stdio";
  if (transportRaw !== undefined) {
    if (transportRaw === "sse" || transportRaw === "stdio") {
      transport = transportRaw;
    } else {
      throw new Error(
        `[mcp-server-ssh] 配置解析错误: MCP_SSH_TRANSPORT 必须为 "stdio" 或 "sse"，收到无效输入 "${transportRaw}"`
      );
    }
  }

  const serverHost = getEnvValue(env, "MCP_SSH_SERVER_HOST") || "0.0.0.0";
  const serverPort = parsePort(
    getEnvValue(env, "MCP_SSH_SERVER_PORT"),
    8000,
    "MCP_SSH_SERVER_PORT"
  );

  // 2. 高级超时与安全选项
  const timeoutMs = parsePositiveInt(
    getEnvValue(env, "MCP_SSH_TIMEOUT"),
    30000,
    "MCP_SSH_TIMEOUT",
    "超时时间"
  );
  const keepAliveIntervalMs = parsePositiveInt(
    getEnvValue(env, "MCP_SSH_KEEP_ALIVE_INTERVAL"),
    10000,
    "MCP_SSH_KEEP_ALIVE_INTERVAL",
    "超时时间"
  );

  const allowDangerousCommands = parseBoolean(
    getEnvValue(env, "MCP_SSH_ALLOW_DANGEROUS_COMMANDS"),
    false,
    "MCP_SSH_ALLOW_DANGEROUS_COMMANDS"
  );

  // 3. 目标主机配置解析
  const host = getEnvValue(env, "MCP_SSH_HOST");
  const sshConfigAlias = getEnvValue(env, "MCP_SSH_CONFIG_ALIAS");
  const username = getEnvValue(env, "MCP_SSH_USER");
  const password = getEnvValue(env, "MCP_SSH_PASSWORD");
  const privateKey = resolvePrivateKey(env, false);
  const passphrase = getEnvValue(env, "MCP_SSH_KEY_PASSPHRASE");
  const portRaw = getEnvValue(env, "MCP_SSH_PORT");

  let target: TargetHostConfig | undefined;
  if (host || sshConfigAlias || username || password || privateKey || passphrase || portRaw) {
    target = {
      host,
      sshConfigAlias,
      port: parsePort(portRaw, 22, "MCP_SSH_PORT"),
      username,
      password,
      privateKey,
      passphrase,
    };
  }

  // 4. 跳板机 (ProxyJump) 配置解析
  const proxyHost = getEnvValue(env, "MCP_SSH_PROXY_HOST");
  let proxyJump: ProxyJumpConfig | undefined;
  if (proxyHost) {
    proxyJump = {
      host: proxyHost,
      port: parsePort(getEnvValue(env, "MCP_SSH_PROXY_PORT"), 22, "MCP_SSH_PROXY_PORT"),
      username: getEnvValue(env, "MCP_SSH_PROXY_USER"),
      password: getEnvValue(env, "MCP_SSH_PROXY_PASSWORD"),
      privateKey: resolvePrivateKey(env, true),
      passphrase: getEnvValue(env, "MCP_SSH_PROXY_KEY_PASSPHRASE"),
    };
  }

  // 5. 安全审计 (Audit Trail) 配置解析 (ADR-0014)
  const auditLogPath = getEnvValue(env, "MCP_SSH_AUDIT_LOG_PATH");
  const auditEnabledRaw = getEnvValue(env, "MCP_SSH_AUDIT_ENABLED");
  let auditEnabled: boolean;
  if (auditEnabledRaw !== undefined) {
    auditEnabled = parseBoolean(auditEnabledRaw, false, "MCP_SSH_AUDIT_ENABLED");
  } else {
    auditEnabled = auditLogPath !== undefined;
  }

  const auditMaxSizeMb = parsePositiveInt(
    getEnvValue(env, "MCP_SSH_AUDIT_MAX_SIZE_MB"),
    10,
    "MCP_SSH_AUDIT_MAX_SIZE_MB"
  );
  const auditMaxFiles = parsePositiveInt(
    getEnvValue(env, "MCP_SSH_AUDIT_MAX_FILES"),
    5,
    "MCP_SSH_AUDIT_MAX_FILES"
  );
  const auditStrict = parseBoolean(
    getEnvValue(env, "MCP_SSH_AUDIT_STRICT"),
    false,
    "MCP_SSH_AUDIT_STRICT"
  );

  const audit: AuditConfig = {
    enabled: auditEnabled,
    logPath: auditLogPath,
    maxSizeMb: auditMaxSizeMb,
    maxFiles: auditMaxFiles,
    strict: auditStrict,
  };

  // 6. 服务标识与多实例指示 (ADR-0015)
  const serverName = getEnvValue(env, "MCP_SSH_SERVER_NAME") || "mcp-server-ssh";
  const serverInstructions = getEnvValue(env, "MCP_SSH_SERVER_INSTRUCTIONS");

  // 7. SSE 身份鉴权令牌 (ADR-0017)
  const authToken = getEnvValue(env, "MCP_SSH_AUTH_TOKEN");

  return {
    transport,
    serverHost,
    serverPort,
    timeoutMs,
    keepAliveIntervalMs,
    allowDangerousCommands,
    target,
    proxyJump,
    audit,
    serverName,
    serverInstructions,
    authToken,
  };
}



/**
 * 敏感凭证数据安全脱敏 (将明文密码与私钥替换为 *** 掩码)
 *
 * @param config 原始应用配置对象
 * @return 字段已脱敏的安全配置映射
 */
export function maskSensitiveConfig(config: AppConfig): Record<string, any> {
  const cloned = JSON.parse(JSON.stringify(config));

  if (cloned.target) {
    if (cloned.target.password) {
      cloned.target.password = "***";
    }
    if (cloned.target.privateKey) {
      cloned.target.privateKey = "***";
    }
    if (cloned.target.passphrase) {
      cloned.target.passphrase = "***";
    }
  }

  if (cloned.proxyJump) {
    if (cloned.proxyJump.password) {
      cloned.proxyJump.password = "***";
    }
    if (cloned.proxyJump.privateKey) {
      cloned.proxyJump.privateKey = "***";
    }
    if (cloned.proxyJump.passphrase) {
      cloned.proxyJump.passphrase = "***";
    }
  }

  if (cloned.authToken) {
    cloned.authToken = "***";
  }

  return cloned;
}

/**
 * 依据 AppConfig 装配默认预建连所需的 SSHConnectParams
 *
 * @param config 应用全局配置
 * @return 格式化后的连接参数，未指定目标时返回 null
 */
export function getPreConnectParams(config: AppConfig): SSHConnectParams | null {
  if (!config.target || (!config.target.host && !config.target.sshConfigAlias)) {
    return null;
  }

  // 1. 组装 ProxyJump 拓扑（若含密码或私钥凭据，组装为结构化对象；否则保持标准字符串）
  let proxyJump: string | ProxyJumpOptions | undefined;
  if (config.proxyJump) {
    if (config.proxyJump.password || config.proxyJump.privateKey || config.proxyJump.passphrase) {
      proxyJump = {
        host: config.proxyJump.host,
        port: config.proxyJump.port,
        username: config.proxyJump.username,
        password: config.proxyJump.password,
        privateKey: config.proxyJump.privateKey,
        passphrase: config.proxyJump.passphrase,
      };
    } else {
      const { username, host, port } = config.proxyJump;
      const userPrefix = username ? `${username}@` : "";
      proxyJump = `${userPrefix}${host}:${port}`;
    }
  }

  return {
    host: config.target.host,
    port: config.target.port,
    username: config.target.username,
    password: config.target.password,
    privateKey: config.target.privateKey,
    passphrase: config.target.passphrase,
    sshConfigAlias: config.target.sshConfigAlias,
    proxyJump,
    readyTimeout: config.timeoutMs,
    keepaliveInterval: config.keepAliveIntervalMs,
    setAsDefault: true,
  };
}
