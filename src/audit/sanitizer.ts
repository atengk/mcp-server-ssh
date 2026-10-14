/**
 * 敏感凭据脱敏清洗引擎 (Credential Sanitizer)
 *
 * 实施零机密泄露不变量 (Zero-Secret Invariant) 与 ADR-0014
 *
 * @author Ateng
 * @since 2026-10-14
 */

/**
 * 默认识别的敏感键名模式列表 (大小写不敏感匹配)
 */
const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /sudopassword/i,
  /privatekey/i,
  /passphrase/i,
  /token/i,
  /secret/i,
  /auth/i,
  /apikey/i,
  /credential/i,
];

/**
 * 判断指定属性键名是否包含机密字段
 *
 * @param key 对象的属性名
 * @return 是否属于敏感属性
 */
function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * 对命令行文本中的常见内联凭据与内嵌私钥执行模式识别与遮蔽
 *
 * @param cmd 原始命令行字符串
 * @return 清洗后的安全命令行文本
 */
export function sanitizeCommand(cmd: string): string {
  if (!cmd || typeof cmd !== "string") {
    return cmd;
  }

  let sanitized = cmd;

  // 1. 擦除内嵌 PEM / OpenSSH 私钥多行块
  sanitized = sanitized.replace(
    /-----BEGIN [A-Z0-9_\s-]+ PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9_\s-]+ PRIVATE KEY-----/gi,
    "[REDACTED_PRIVATE_KEY]"
  );

  // 2. 擦除 mysql / mysqldump 等工具内联 -p <password> (严格约束工具上下文，避免误伤 mkdir -p / ssh -p)
  sanitized = sanitized.replace(
    /\b(mysql(?:dump)?\s+[^;&|]*?-p\s+)([^\s"';&|]+)/gi,
    "$1[REDACTED]"
  );

  // 3. 擦除 --password=xxx 或 --password xxx 以及 token / secret 参数
  sanitized = sanitized.replace(
    /(--(?:password|passphrase|secret|token)[=\s]+)(?:(?:"[^"]*")|(?:'[^']*')|(?:[^\s;&|]+))/gi,
    "$1[REDACTED]"
  );

  // 4. 擦除 redis-cli -a <password> (严格约束 redis-cli 上下文，避免误伤 ls -a / git commit -a)
  sanitized = sanitized.replace(
    /\b(redis-cli\s+[^;&|]*?-a\s+)([^\s"';&|]+)/gi,
    "$1[REDACTED]"
  );


  // 5. 擦除 curl -u user:password
  sanitized = sanitized.replace(/(-u\s+[a-zA-Z0-9_.-]+:)([^\s"';&|]+)/g, "$1[REDACTED]");

  // 6. 擦除 export SECRET_KEY=xxx 或 export API_TOKEN="xxx"
  sanitized = sanitized.replace(
    /(export\s+[A-Za-z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|PASS)[A-Za-z0-9_]*=)(?:(?:"[^"]*")|(?:'[^']*')|(?:[^\s;&|]+))/gi,
    "$1[REDACTED]"
  );

  return sanitized;
}

/**
 * 递归遍历对象树并擦除机密凭据键值与内联命令凭据
 *
 * @param params 待脱敏的参数、对象或数组
 * @param visited 循环引用防爆检测集合
 * @return 深度克隆且脱敏后的安全副本
 */
export function sanitizeParams(params: unknown, visited = new WeakSet<object>()): unknown {
  // 1. 处理空值与基元类型
  if (params === null || typeof params !== "object") {
    return params;
  }

  // 2. 防御循环引用导致栈溢出
  if (visited.has(params as object)) {
    return "[Circular]";
  }
  visited.add(params as object);

  // 3. 处理数组类型
  if (Array.isArray(params)) {
    return params.map((item) => sanitizeParams(item, visited));
  }

  // 4. 处理普通对象类型
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (key === "command" && typeof value === "string") {
      result[key] = sanitizeCommand(value);
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizeParams(value, visited);
    } else {
      result[key] = value;
    }
  }

  return result;
}
