/**
 * 环境变量解析与集中配置管理器单元测试
 *
 * @author Ateng
 * @since 2026-10-04
 */

import { describe, expect, it } from "vitest";
import { getPreConnectParams, maskSensitiveConfig, parseEnv } from "./env.js";

describe("环境变量集中解析体系 (parseEnv)", () => {
  it("默认环境下应返回标准的缺省配置", () => {
    const config = parseEnv({});

    expect(config.transport).toBe("stdio");
    expect(config.serverHost).toBe("0.0.0.0");
    expect(config.serverPort).toBe(8000);
    expect(config.timeoutMs).toBe(30000);
    expect(config.keepAliveIntervalMs).toBe(10000);
    expect(config.allowDangerousCommands).toBe(false);
    expect(config.target).toBeUndefined();
    expect(config.proxyJump).toBeUndefined();
  });

  it("官方标准前缀 MCP_SSH_* 应优先于遗留前缀 SSH_*", () => {
    const env = {
      MCP_SSH_HOST: "canonical-host.example.com",
      SSH_HOST: "legacy-host.example.com",
      MCP_SSH_PORT: "2222",
      SSH_PORT: "22",
      MCP_SSH_USER: "canonical-user",
      SSH_USER: "legacy-user",
      MCP_SSH_TRANSPORT: "sse",
      SSH_TRANSPORT: "stdio",
      MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "true",
      SSH_ALLOW_DANGEROUS_COMMANDS: "false",
    };

    const config = parseEnv(env);

    expect(config.transport).toBe("sse");
    expect(config.allowDangerousCommands).toBe(true);
    expect(config.target?.host).toBe("canonical-host.example.com");
    expect(config.target?.port).toBe(2222);
    expect(config.target?.username).toBe("canonical-user");
  });

  it("当未指定标准前缀时应平滑回退支持遗留前缀 SSH_*", () => {
    const env = {
      SSH_HOST: "legacy-host.example.com",
      SSH_PORT: "2200",
      SSH_USER: "legacy-user",
      SSH_PASSWORD: "legacy-password",
      SSH_TIMEOUT: "45000",
      SSH_ALLOW_DANGEROUS_COMMANDS: "1",
    };

    const config = parseEnv(env);

    expect(config.target?.host).toBe("legacy-host.example.com");
    expect(config.target?.port).toBe(2200);
    expect(config.target?.username).toBe("legacy-user");
    expect(config.target?.password).toBe("legacy-password");
    expect(config.timeoutMs).toBe(45000);
    expect(config.allowDangerousCommands).toBe(true);
  });

  it("应支持宽容布尔值转换 (大小写不敏感、数字与常见真值)", () => {
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "true" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "TRUE" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "1" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "yes" }).allowDangerousCommands).toBe(true);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "on" }).allowDangerousCommands).toBe(true);

    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "false" }).allowDangerousCommands).toBe(false);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "0" }).allowDangerousCommands).toBe(false);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "no" }).allowDangerousCommands).toBe(false);
    expect(parseEnv({ MCP_SSH_ALLOW_DANGEROUS_COMMANDS: "" }).allowDangerousCommands).toBe(false);
  });

  it("非法的端口号或数字应抛出语义明确的异常", () => {
    expect(() => parseEnv({ MCP_SSH_PORT: "invalid-port" })).toThrow(/无效的端口号/);
    expect(() => parseEnv({ MCP_SSH_PORT: "0" })).toThrow(/端口号超出有效范围/);
    expect(() => parseEnv({ MCP_SSH_PORT: "70000" })).toThrow(/端口号超出有效范围/);
    expect(() => parseEnv({ MCP_SSH_SERVER_PORT: "not-a-number" })).toThrow(/无效的端口号/);
    expect(() => parseEnv({ MCP_SSH_TIMEOUT: "-100" })).toThrow(/超时时间必须为正整数/);
  });

  describe("私钥多形态凭证解析", () => {
    it("应正确保留物理文件路径", () => {
      const config = parseEnv({
        MCP_SSH_KEY_PATH: "/home/user/.ssh/id_ed25519",
      });

      expect(config.target?.privateKey).toBe("/home/user/.ssh/id_ed25519");
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
        MCP_SSH_KEY_PATH: "/some/path",
      });

      expect(config.target?.privateKey).toBe(rawPem);
    });
  });

  describe("跳板机 (ProxyJump) 预配置解析", () => {
    it("应支持从环境变量完整解析跳板机拓扑", () => {
      const env = {
        MCP_SSH_HOST: "10.0.0.5",
        MCP_SSH_PROXY_HOST: "bastion.example.com",
        MCP_SSH_PROXY_PORT: "2222",
        MCP_SSH_PROXY_USER: "jumpadmin",
        MCP_SSH_PROXY_PASSWORD: "jump-secret-password",
        MCP_SSH_PROXY_KEY_PATH: "/root/.ssh/bastion_key",
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
      // 检查跳板机组装 (无密码私钥时为标准字符串)
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
});
