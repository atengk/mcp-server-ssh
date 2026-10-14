/**
 * 敏感凭据脱敏引擎单元测试 (Zero-Secret Sanitizer)
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it } from "vitest";
import { sanitizeCommand, sanitizeParams } from "./sanitizer.js";

describe("敏感凭据脱敏引擎 (Credential Sanitizer) - ADR-0014", () => {
  describe("对象与参数树深度递归脱敏 (sanitizeParams)", () => {
    it("普通无敏感字段的对象应原样保留结构与数据", () => {
      const input = {
        host: "192.168.1.10",
        port: 22,
        username: "admin",
        command: "ls -la /var/log",
        options: {
          recursive: true,
          limit: 100,
        },
      };

      const sanitized = sanitizeParams(input);
      expect(sanitized).toEqual(input);
      expect(sanitized).not.toBe(input); // 必须是防御性深拷贝
    });

    it("常见敏感键名应被递归深层拦截并遮蔽为 [REDACTED]", () => {
      const input = {
        host: "10.0.0.1",
        password: "SuperSecretPassword123!",
        user: "root",
        nested: {
          sudoPassword: "RootPassword999",
          privateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
          passphrase: "key-passphrase",
          apiKey: "sk-1234567890abcdef",
          token: "jwt.token.here",
          oauth_secret: "shhh_secret",
        },
        list: [
          { auth_token: "token_1" },
          { harmless: "ok" },
        ],
      };

      const result = sanitizeParams(input) as any;
      expect(result.password).toBe("[REDACTED]");
      expect(result.user).toBe("root");
      expect(result.nested.sudoPassword).toBe("[REDACTED]");
      expect(result.nested.privateKey).toBe("[REDACTED]");
      expect(result.nested.passphrase).toBe("[REDACTED]");
      expect(result.nested.apiKey).toBe("[REDACTED]");
      expect(result.nested.token).toBe("[REDACTED]");
      expect(result.nested.oauth_secret).toBe("[REDACTED]");
      expect(result.list[0].auth_token).toBe("[REDACTED]");
      expect(result.list[1].harmless).toBe("ok");
    });

    it("大小写不敏感键名检测 (PASSWORD, PrivateKey 等)", () => {
      const input = {
        PASSWORD: "123",
        PrivateKey: "abc",
        SECRET_KEY: "def",
      };

      const result = sanitizeParams(input) as any;
      expect(result.PASSWORD).toBe("[REDACTED]");
      expect(result.PrivateKey).toBe("[REDACTED]");
      expect(result.SECRET_KEY).toBe("[REDACTED]");
    });

    it("循环引用对象应被防御性处理，绝不抛出 RangeError 栈溢出", () => {
      const circular: any = { name: "test", password: "secret" };
      circular.self = circular;

      expect(() => {
        const sanitized = sanitizeParams(circular) as any;
        expect(sanitized.name).toBe("test");
        expect(sanitized.password).toBe("[REDACTED]");
        expect(sanitized.self).toBe("[Circular]");
      }).not.toThrow();
    });

    it("基元类型与空值应安全穿透", () => {
      expect(sanitizeParams(null)).toBeNull();
      expect(sanitizeParams(undefined)).toBeUndefined();
      expect(sanitizeParams("hello")).toBe("hello");
      expect(sanitizeParams(12345)).toBe(12345);
      expect(sanitizeParams(true)).toBe(true);
    });
  });

  describe("命令行内联明文凭据模式擦除 (sanitizeCommand)", () => {
    it("包含常见内联密码选项的命令应被自动遮蔽", () => {
      expect(sanitizeCommand("mysql -u root -p password123 db")).toBe("mysql -u root -p [REDACTED] db");
      expect(sanitizeCommand("mysqldump -u admin --password=topsecret db")).toBe("mysqldump -u admin --password=[REDACTED] db");
      expect(sanitizeCommand("redis-cli -a mypassword ping")).toBe("redis-cli -a [REDACTED] ping");
      expect(sanitizeCommand("curl -u user:pass1234 http://example.com")).toBe("curl -u user:[REDACTED] http://example.com");
      expect(sanitizeCommand("export SECRET_KEY=my_key_123 && ./run.sh")).toBe("export SECRET_KEY=[REDACTED] && ./run.sh");
      expect(sanitizeCommand("export API_TOKEN=\"token_abc\" && ./run.sh")).toBe("export API_TOKEN=[REDACTED] && ./run.sh");
    });

    it("包含内嵌 PEM 私钥文本的命令应被全量屏蔽", () => {
      const cmd = "echo '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjE...\n-----END OPENSSH PRIVATE KEY-----' > id_rsa";
      expect(sanitizeCommand(cmd)).toContain("[REDACTED_PRIVATE_KEY]");
      expect(sanitizeCommand(cmd)).not.toContain("b3BlbnNzaC1rZXktdjE");
    });

    it("常规非敏感 Linux 命令与常见参数 (如 mkdir -p, ssh -p 22, ls -a) 应绝对保持不变，严禁误伤", () => {
      expect(sanitizeCommand("mkdir -p /var/log/app")).toBe("mkdir -p /var/log/app");
      expect(sanitizeCommand("ssh -p 2222 user@host")).toBe("ssh -p 2222 user@host");
      expect(sanitizeCommand("ls -a /home/ubuntu")).toBe("ls -a /home/ubuntu");
      expect(sanitizeCommand("git commit -a -m 'fix'")).toBe("git commit -a -m 'fix'");
      expect(sanitizeCommand("ls -la /var/log")).toBe("ls -la /var/log");
      expect(sanitizeCommand("ps aux | grep node")).toBe("ps aux | grep node");
      expect(sanitizeCommand("cat /etc/os-release")).toBe("cat /etc/os-release");
    });
  });
});

