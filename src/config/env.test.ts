/**
 * 环境变量解析与集中配置管理器单元测试
 *
 * @author Ateng
 * @since 2026-10-04
 */

import { describe, expect, it } from "vitest";
import { getPreConnectParams, maskSensitiveConfig, parseEnv } from "./env.js";

describe("环境变量集中解析体系 (parseEnv) - 严格治理", () => {
  it("默认环境下应返回标准的缺省配置", () => {
    const config = parseEnv({});

    expect(config.transport).toBe("stdio");
    expect(config.serverHost).toBe("127.0.0.1");
    expect(config.serverPort).toBe(8000);
    expect(config.timeoutMs).toBe(30000);
    expect(config.keepAliveIntervalMs).toBe(10000);
    expect(config.allowDangerousCommands).toBe(false);
    expect(config.target).toBeUndefined();
    expect(config.proxyJump).toBeUndefined();
  });

  it("非 MCP_SSH_* 前缀的遗留变量应被完全静默忽略 (零别名降级)", () => {
    const legacyEnv = {
      SSH_HOST: "legacy-host.example.com",
      SSH_PORT: "2200",
      SSH_USER: "legacy-user",
      SSH_PASSWORD: "legacy-password",
      SSH_TIMEOUT: "45000",
      SSH_ALLOW_DANGEROUS_COMMANDS: "true",
      PORT: "9000",
      HOST: "0.0.0.0",
      SSH_TRANSPORT: "sse",
      MCP_TRANSPORT: "sse",
    };

    const config = parseEnv(legacyEnv);

    // 均保持默认值，遗留变量未被读取
    expect(config.transport).toBe("stdio");
    expect(config.serverHost).toBe("127.0.0.1");
    expect(config.serverPort).toBe(8000);
    expect(config.timeoutMs).toBe(30000);
    expect(config.allowDangerousCommands).toBe(false);
    expect(config.target).toBeUndefined();
  });

  it("SSE 模式下外部非回环绑定且未配置 MCP_SSH_AUTH_TOKEN 时应触发安全熔断 (Fail-Closed)", () => {
    expect(() =>
      parseEnv({
        MCP_SSH_TRANSPORT: "sse",
        MCP_SSH_SERVER_HOST: "0.0.0.0",
      })
    ).toThrowError(/安全熔断: 外部网络绑定 \(0\.0\.0\.0\) 必须配置 MCP_SSH_AUTH_TOKEN/);

    expect(() =>
      parseEnv({
        MCP_SSH_TRANSPORT: "sse",
        MCP_SSH_SERVER_HOST: "192.168.1.100",
      })
    ).toThrowError(/安全熔断/);
  });

  it("SSE 模式下外部非回环绑定但配置了 MCP_SSH_AUTH_TOKEN 应正常通过", () => {
    const config = parseEnv({
      MCP_SSH_TRANSPORT: "sse",
      MCP_SSH_SERVER_HOST: "0.0.0.0",
      MCP_SSH_AUTH_TOKEN: "valid-secret-token",
    });
    expect(config.serverHost).toBe("0.0.0.0");
    expect(config.authToken).toBe("valid-secret-token");
  });

  it("SSE 模式下回环地址绑定即使未提供 MCP_SSH_AUTH_TOKEN 也允许启动 (本地开发豁免)", () => {
    const config = parseEnv({
      MCP_SSH_TRANSPORT: "sse",
      MCP_SSH_SERVER_HOST: "127.0.0.1",
    });
    expect(config.serverHost).toBe("127.0.0.1");
    expect(config.authToken).toBeUndefined();
  });

  it("官方标准前缀 MCP_SSH_* 才能正确被解析生效", () => {
    const canonicalEnv = {
      MCP_SSH_HOST: "canonical-host.example.com",
      MCP_SSH_PORT: "2222",
      MCP_SSH_USER: "canonical-user",
      MCP_SSH_PASSWORD: "canonical-password",
      MCP_SSH_TRANSPORT: "sse",
      MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "true",
      MCP_SSH_TIMEOUT: "45000",
      MCP_SSH_KEEP_ALIVE_INTERVAL: "15000",
    };

    const config = parseEnv(canonicalEnv);

    expect(config.transport).toBe("sse");
    expect(config.allowDangerousCommands).toBe(true);
    expect(config.timeoutMs).toBe(45000);
    expect(config.keepAliveIntervalMs).toBe(15000);
    expect(config.target?.host).toBe("canonical-host.example.com");
    expect(config.target?.port).toBe(2222);
    expect(config.target?.username).toBe("canonical-user");
    expect(config.target?.password).toBe("canonical-password");
  });

  it("严格布尔类型校验：仅允许大小写不敏感的 true 与 false", () => {
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "true" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "TRUE" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: " True " }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "false" }).allowDangerousCommands).toBe(false);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "FALSE" }).allowDangerousCommands).toBe(false);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: " False " }).allowDangerousCommands).toBe(false);
  });

  it("传入模糊或非标布尔值时应立即抛出明确异常熔断启动", () => {
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "1" })).toThrow(/必须为合法的布尔值/);
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "0" })).toThrow(/必须为合法的布尔值/);
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "yes" })).toThrow(/必须为合法的布尔值/);
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "no" })).toThrow(/必须为合法的布尔值/);
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "on" })).toThrow(/必须为合法的布尔值/);
    expect(() => parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "invalid_val" })).toThrow(/必须为合法的布尔值/);
  });

  it("传输模式 MCP_SSH_TRANSPORT 必须严格为 stdio 或 sse", () => {
    expect(parseEnv({ MCP_SSH_TRANSPORT: "sse" }).transport).toBe("sse");
    expect(parseEnv({ MCP_SSH_TRANSPORT: "stdio" }).transport).toBe("stdio");
    expect(() => parseEnv({ MCP_SSH_TRANSPORT: "http" })).toThrow(/必须为 "stdio" 或 "sse"/);
    expect(() => parseEnv({ MCP_SSH_TRANSPORT: "websocket" })).toThrow(/必须为 "stdio" 或 "sse"/);
  });

  it("非法的端口号或数字应抛出语义明确的异常", () => {
    expect(() => parseEnv({ MCP_SSH_PORT: "invalid-port" })).toThrow(/无效的端口号/);
    expect(() => parseEnv({ MCP_SSH_PORT: "0" })).toThrow(/端口号超出有效范围/);
    expect(() => parseEnv({ MCP_SSH_PORT: "70000" })).toThrow(/端口号超出有效范围/);
    expect(() => parseEnv({ MCP_SSH_SERVER_PORT: "not-a-number" })).toThrow(/无效的端口号/);
    expect(() => parseEnv({ MCP_SSH_TIMEOUT: "-100" })).toThrow(/超时时间必须为正整数/);
    expect(() => parseEnv({ MCP_SSH_KEEP_ALIVE_INTERVAL: "0" })).toThrow(/超时时间必须为正整数/);
  });

  describe("私钥凭据唯一对齐解析 (MCP_SSH_PRIVATE_KEY_PATH)", () => {
    it("应正确读取 MCP_SSH_PRIVATE_KEY_PATH 物理文件路径且忽略非标 KEY_PATH", () => {
      const config1 = parseEnv({
        MCP_SSH_PRIVATE_KEY_PATH: "/home/user/.ssh/id_ed25519",
      });
      expect(config1.target?.privateKey).toBe("/home/user/.ssh/id_ed25519");

      // 遗留的 MCP_SSH_KEY_PATH 应被忽略
      const config2 = parseEnv({
        MCP_SSH_KEY_PATH: "/home/user/.ssh/id_ed25519",
      });
      expect(config2.target).toBeUndefined();
    });

    it("应将字面量换行符 \\n 还原为真正的多行 PEM 私钥文本", () => {
      const escapedPem = "-----BEGIN OPENSSH PRIVATE KEY-----\\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDd\\n-----END OPENSSH PRIVATE KEY-----";
      const config = parseEnv({
        MCP_SSH_PRIVATE_KEY: escapedPem,
      });

      expect(config.target?.privateKey).toContain("\n");
      expect(config.target?.privateKey).toBe(
        "-----BEGIN OPENSSH PRIVATE KEY-----\nMIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDd\n-----END OPENSSH PRIVATE KEY-----"
      );
    });

    it("应自动将 Base64 编码的私钥解码为 UTF-8 字符串", () => {
      const rawPem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0\n-----END RSA PRIVATE KEY-----";
      const base64Pem = Buffer.from(rawPem, "utf-8").toString("base64");

      const config = parseEnv({
        MCP_SSH_PRIVATE_KEY_BASE64: base64Pem,
      });

      expect(config.target?.privateKey).toBe(rawPem);
    });

    it("Base64 私钥优先级应高于普通私钥文本与路径", () => {
      const rawPem = "-----BEGIN FROM BASE64-----";
      const base64Pem = Buffer.from(rawPem, "utf-8").toString("base64");

      const config = parseEnv({
        MCP_SSH_PRIVATE_KEY_BASE64: base64Pem,
        MCP_SSH_PRIVATE_KEY: "-----BEGIN FROM RAW-----",
        MCP_SSH_PRIVATE_KEY_PATH: "/some/path",
      });

      expect(config.target?.privateKey).toBe(rawPem);
    });
  });

  describe("跳板机 (ProxyJump) 预配置解析", () => {
    it("应支持从规范环境变量完整解析跳板机拓扑", () => {
      const env = {
        MCP_SSH_HOST: "10.0.0.5",
        MCP_SSH_PROXY_HOST: "bastion.example.com",
        MCP_SSH_PROXY_PORT: "2222",
        MCP_SSH_PROXY_USER: "jumpadmin",
        MCP_SSH_PROXY_PASSWORD: "jump-secret-password",
        MCP_SSH_PROXY_PRIVATE_KEY_PATH: "/root/.ssh/bastion_key",
      };

      const config = parseEnv(env);

      expect(config.proxyJump).toBeDefined();
      expect(config.proxyJump?.host).toBe("bastion.example.com");
      expect(config.proxyJump?.port).toBe(2222);
      expect(config.proxyJump?.username).toBe("jumpadmin");
      expect(config.proxyJump?.password).toBe("jump-secret-password");
      expect(config.proxyJump?.privateKey).toBe("/root/.ssh/bastion_key");
    });

    it("跳板机私钥亦应支持 Base64 自动解码", () => {
      const rawJumpKey = "-----BEGIN BASTION KEY-----";
      const base64JumpKey = Buffer.from(rawJumpKey, "utf-8").toString("base64");

      const config = parseEnv({
        MCP_SSH_PROXY_HOST: "bastion.example.com",
        MCP_SSH_PROXY_PRIVATE_KEY_BASE64: base64JumpKey,
      });

      expect(config.proxyJump?.privateKey).toBe(rawJumpKey);
    });
  });

  describe("敏感数据掩码 (maskSensitiveConfig)", () => {
    it("密码与私钥应被可靠脱敏为 ***", () => {
      const config = parseEnv({
        MCP_SSH_HOST: "192.168.1.100",
        MCP_SSH_USER: "root",
        MCP_SSH_PASSWORD: "SuperSecretPassword123",
        MCP_SSH_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0...",
        MCP_SSH_KEY_PASSPHRASE: "MyKeyPassphrase",
        MCP_SSH_PROXY_HOST: "bastion.internal",
        MCP_SSH_PROXY_PASSWORD: "BastionPassword456",
      });

      const masked = maskSensitiveConfig(config);

      expect(masked.target?.password).toBe("***");
      expect(masked.target?.privateKey).toBe("***");
      expect(masked.target?.passphrase).toBe("***");
      expect(masked.proxyJump?.password).toBe("***");
      expect(masked.target?.host).toBe("192.168.1.100");
      expect(masked.target?.username).toBe("root");
    });

    it("authToken 应当在 maskSensitiveConfig 中被掩码为 ***", () => {
      const config = parseEnv({
        MCP_SSH_AUTH_TOKEN: "super-secret-token",
      });
      expect(config.authToken).toBe("super-secret-token");
      const masked = maskSensitiveConfig(config);
      expect(masked.authToken).toBe("***");
    });

    it("正确解析 MCP_SSH_ALLOWED_TARGETS 与 MCP_SSH_DISABLE_DYNAMIC_CONNECT", () => {
      const config = parseEnv({
        MCP_SSH_ALLOWED_TARGETS: " 192.168.1.0/24 , *.internal.corp , bastion.example.com:2200 ",
        MCP_SSH_DISABLE_DYNAMIC_CONNECT: "true",
      });
      expect(config.allowedTargets).toEqual([
        "192.168.1.0/24",
        "*.internal.corp",
        "bastion.example.com:2200",
      ]);
      expect(config.disableDynamicConnect).toBe(true);
    });

    it("MCP_SSH_DISABLE_DYNAMIC_CONNECT 传非标值时抛出配置解析异常", () => {
      expect(() =>
        parseEnv({
          MCP_SSH_DISABLE_DYNAMIC_CONNECT: "yes",
        })
      ).toThrowError(/必须为合法的布尔值/);
    });

    it("正确解析 MCP_SSH_ALLOWED_ORIGINS 逗号分隔白名单并去除首尾空格", () => {
      const config = parseEnv({
        MCP_SSH_ALLOWED_ORIGINS: " http://localhost:3000 , https://chat.internal.example.com ",
      });
      expect(config.allowedOrigins).toEqual([
        "http://localhost:3000",
        "https://chat.internal.example.com",
      ]);
    });
  });

  describe("预建连参数装配 (getPreConnectParams)", () => {
    it("未配置目标主机时应返回 null", () => {
      const config = parseEnv({});
      expect(getPreConnectParams(config)).toBeNull();
    });

    it("配置有效主机时应组装为合法的 SSHConnectParams", () => {
      const config = parseEnv({
        MCP_SSH_HOST: "192.168.1.100",
        MCP_SSH_PORT: "2200",
        MCP_SSH_USER: "deploy",
        MCP_SSH_PASSWORD: "secret-password",
        MCP_SSH_PROXY_HOST: "bastion.example.com",
        MCP_SSH_PROXY_PORT: "2222",
        MCP_SSH_PROXY_USER: "jumpuser",
      });

      const params = getPreConnectParams(config);

      expect(params).not.toBeNull();
      expect(params?.host).toBe("192.168.1.100");
      expect(params?.port).toBe(2200);
      expect(params?.username).toBe("deploy");
      expect(params?.password).toBe("secret-password");
      expect(params?.setAsDefault).toBe(true);
      expect(params?.readyTimeout).toBe(30000);
      expect(params?.keepaliveInterval).toBe(10000);
      expect(params?.proxyJump).toBe("jumpuser@bastion.example.com:2222");
    });

    it("当跳板机包含独立密码凭据时应组装为结构化 ProxyJumpOptions 对象", () => {
      const config = parseEnv({
        MCP_SSH_HOST: "192.168.1.100",
        MCP_SSH_PROXY_HOST: "bastion.example.com",
        MCP_SSH_PROXY_PORT: "2222",
        MCP_SSH_PROXY_USER: "jumpadmin",
        MCP_SSH_PROXY_PASSWORD: "jump-password",
      });

      const params = getPreConnectParams(config);
      expect(typeof params?.proxyJump).toBe("object");
      expect((params?.proxyJump as any)?.password).toBe("jump-password");
      expect((params?.proxyJump as any)?.host).toBe("bastion.example.com");
    });

    it("仅配置跳板机 host 时应组装为 bastion.example.com:22", () => {
      const config = parseEnv({
        MCP_SSH_HOST: "192.168.1.100",
        MCP_SSH_PROXY_HOST: "bastion.example.com",
      });

      const params = getPreConnectParams(config);
      expect(params?.proxyJump).toBe("bastion.example.com:22");
    });
  });

  describe("安全审计配置解析体系 (ADR-0014)", () => {
    it("缺省环境下应返回默认关闭且合规的审计配置", () => {
      const config = parseEnv({});
      expect(config.audit).toEqual({
        enabled: false,
        logPath: undefined,
        maxSizeMb: 10,
        maxFiles: 5,
        strict: false,
      });
    });

    it("设置 MCP_SSH_AUDIT_LOG_PATH 时若未设置 ENABLED 则应自动激活", () => {
      const config = parseEnv({
        MCP_SSH_AUDIT_LOG_PATH: "/var/log/mcp_audit.log",
      });
      expect(config.audit.enabled).toBe(true);
      expect(config.audit.logPath).toBe("/var/log/mcp_audit.log");
      expect(config.audit.maxSizeMb).toBe(10);
      expect(config.audit.maxFiles).toBe(5);
      expect(config.audit.strict).toBe(false);
    });

    it("显式设置 MCP_SSH_AUDIT_ENABLED 为 false 时即使配置路径也不激活", () => {
      const config = parseEnv({
        MCP_SSH_AUDIT_ENABLED: "false",
        MCP_SSH_AUDIT_LOG_PATH: "/var/log/mcp_audit.log",
      });
      expect(config.audit.enabled).toBe(false);
      expect(config.audit.logPath).toBe("/var/log/mcp_audit.log");
    });

    it("显式设置 MCP_SSH_AUDIT_ENABLED 为 true 但未设置路径时仍激活 (输出至 stderr)", () => {
      const config = parseEnv({
        MCP_SSH_AUDIT_ENABLED: "true",
      });
      expect(config.audit.enabled).toBe(true);
      expect(config.audit.logPath).toBeUndefined();
    });

    it("支持自定义轮转文件大小与备份文件数，且严格正整数校验", () => {
      const config = parseEnv({
        MCP_SSH_AUDIT_LOG_PATH: "audit.log",
        MCP_SSH_AUDIT_MAX_SIZE_MB: "50",
        MCP_SSH_AUDIT_MAX_FILES: "10",
        MCP_SSH_AUDIT_STRICT: "true",
      });
      expect(config.audit.maxSizeMb).toBe(50);
      expect(config.audit.maxFiles).toBe(10);
      expect(config.audit.strict).toBe(true);

      expect(() =>
        parseEnv({
          MCP_SSH_AUDIT_MAX_SIZE_MB: "-1",
        })
      ).toThrow(/必须为正整数/);

      expect(() =>
        parseEnv({
          MCP_SSH_AUDIT_MAX_FILES: "0",
        })
      ).toThrow(/必须为正整数/);

      expect(() =>
        parseEnv({
          MCP_SSH_AUDIT_STRICT: "not_boolean",
        })
      ).toThrow(/必须为合法的布尔值/);
    });
  });

  describe("服务标识与多实例指示体系 (ADR-0015)", () => {
    it("缺省环境下 serverName 默认为 mcp-server-ssh，instructions 默认为 undefined", () => {
      const config = parseEnv({});
      expect(config.serverName).toBe("mcp-server-ssh");
      expect(config.serverInstructions).toBeUndefined();
    });

    it("正确从规范环境变量解析 MCP_SSH_SERVER_NAME 与 MCP_SSH_SERVER_INSTRUCTIONS", () => {
      const config = parseEnv({
        MCP_SSH_SERVER_NAME: "prod-bastion-ssh",
        MCP_SSH_SERVER_INSTRUCTIONS: "本实例专门用于生产跳板机，严禁执行重启操作",
      });

      expect(config.serverName).toBe("prod-bastion-ssh");
      expect(config.serverInstructions).toBe("本实例专门用于生产跳板机，严禁执行重启操作");
    });
  });
});


