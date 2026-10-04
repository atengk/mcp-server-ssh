/**
 * 凭证探测与解析器单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CredentialResolver } from "./credentials.js";

describe("CredentialResolver 凭证解析器", () => {
  const tempDir = path.join(os.tmpdir(), "mcp-ssh-cred-test-" + Date.now());
  const fakeKeyFile = path.join(tempDir, "test_ed25519");

  beforeEach(() => {
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(fakeKeyFile, "-----BEGIN OPENSSH PRIVATE KEY-----\nFAKEDATA\n-----END OPENSSH PRIVATE KEY-----");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("应当支持直接提供密钥文件路径并读取其文本内容", async () => {
    const resolver = new CredentialResolver();
    const config = await resolver.resolve({
      host: "10.0.0.1",
      username: "testuser",
      privateKey: fakeKeyFile,
      passphrase: "secret-phrase",
    });

    expect(config.host).toBe("10.0.0.1");
    expect(config.username).toBe("testuser");
    expect(config.privateKey?.toString()).toContain("OPENSSH PRIVATE KEY");
    expect(config.passphrase).toBe("secret-phrase");
  });

  it("应当支持直接提供 PEM 格式的密钥字符串文本内容", async () => {
    const resolver = new CredentialResolver();
    const pemContent = "-----BEGIN RSA PRIVATE KEY-----\nRAWPEMSTRING\n-----END RSA PRIVATE KEY-----";
    const config = await resolver.resolve({
      host: "10.0.0.1",
      username: "testuser",
      privateKey: pemContent,
    });

    expect(config.privateKey?.toString()).toBe(pemContent);
  });

  it("应当正确解析直接提供的密码凭据", async () => {
    const resolver = new CredentialResolver();
    const config = await resolver.resolve({
      host: "10.0.0.1",
      username: "testuser",
      password: "plain-password",
    });

    expect(config.password).toBe("plain-password");
  });

  it("应当支持直接提供 Base64 编码的密钥字符串并自动解码为原始 PEM", async () => {
    const resolver = new CredentialResolver();
    const rawPem = "-----BEGIN RSA PRIVATE KEY-----\nBASE64DECODED\n-----END RSA PRIVATE KEY-----";
    const base64Key = Buffer.from(rawPem, "utf-8").toString("base64");
    const config = await resolver.resolve({
      host: "10.0.0.1",
      username: "testuser",
      privateKey: base64Key,
    });

    expect(config.privateKey?.toString()).toBe(rawPem);
  });

  it("应当自动将 PEM 密钥中转义的字面量 \\n 还原为真实换行", async () => {
    const resolver = new CredentialResolver();
    const escapedPem = "-----BEGIN RSA PRIVATE KEY-----\\nLINE1\\nLINE2\\n-----END RSA PRIVATE KEY-----";
    const expected = "-----BEGIN RSA PRIVATE KEY-----\nLINE1\nLINE2\n-----END RSA PRIVATE KEY-----";
    const config = await resolver.resolve({
      host: "10.0.0.1",
      username: "testuser",
      privateKey: escapedPem,
    });

    expect(config.privateKey?.toString()).toBe(expected);
  });

  it("应当正确传递自定义的 readyTimeout 与 keepaliveInterval 至底层配置", async () => {
    const resolver = new CredentialResolver();
    const config = await resolver.resolve({
      host: "10.0.0.1",
      readyTimeout: 45000,
      keepaliveInterval: 15000,
    });

    expect(config.readyTimeout).toBe(45000);
    expect(config.keepaliveInterval).toBe(15000);
  });

  it("当未显式指定用户名时，应当兜底使用宿主机当前操作系统的用户名", async () => {
    const resolver = new CredentialResolver();
    const config = await resolver.resolve({
      host: "10.0.0.1",
    });

    expect(config.username).toBe(os.userInfo().username || "root");
  });
});
