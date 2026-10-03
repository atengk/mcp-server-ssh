/**
 * SSH 配置文件解析器单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { describe, expect, it } from "vitest";
import { SSHConfigParser } from "./config-parser.js";

const sampleConfig = `
Host prod-api
  HostName 10.0.1.10
  User deploy
  Port 2222
  IdentityFile ~/.ssh/id_rsa_prod
  ProxyJump bastion-jump

Host bastion-jump
  HostName 203.0.113.5
  User bastion
  IdentityFile ~/.ssh/id_rsa_bastion

Host *
  Port 22
  ServerAliveInterval 60
`;

describe("SSHConfigParser 配置文件解析器", () => {
  it("应当从配置文本中列出所有明确命名的 Host 别名（忽略通配符 *）", () => {
    const parser = new SSHConfigParser(sampleConfig);
    const hosts = parser.listHosts();
    expect(hosts).toHaveLength(2);
    expect(hosts.map((h) => h.alias)).toEqual(["prod-api", "bastion-jump"]);
  });

  it("应当正确解析特定 Host 别名的合并属性与通配符默认值", () => {
    const parser = new SSHConfigParser(sampleConfig);
    const resolved = parser.resolveHost("prod-api");
    expect(resolved).not.toBeNull();
    expect(resolved?.host).toBe("10.0.1.10");
    expect(resolved?.username).toBe("deploy");
    expect(resolved?.port).toBe(2222);
    expect(resolved?.proxyJump).toBe("bastion-jump");
    expect(resolved?.privateKey).toContain("id_rsa_prod");
  });

  it("应当正确解析未显式指定端口的主机并使用通配符默认端口", () => {
    const parser = new SSHConfigParser(sampleConfig);
    const resolved = parser.resolveHost("bastion-jump");
    expect(resolved).not.toBeNull();
    expect(resolved?.host).toBe("203.0.113.5");
    expect(resolved?.username).toBe("bastion");
    expect(resolved?.port).toBe(22);
  });

  it("对不存在的别名应当返回 null", () => {
    const parser = new SSHConfigParser(sampleConfig);
    const resolved = parser.resolveHost("non-existent-server");
    expect(resolved).toBeNull();
  });
});
