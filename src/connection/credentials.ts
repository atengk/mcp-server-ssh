/**
 * SSH 认证凭证解析与本地密钥链探测器
 *
 * @author Ateng
 * @since 2026-10-03
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ConnectConfig } from "ssh2";
import type { SSHConnectParams } from "../types/connection.js";

/**
 * 默认尝试探测的本地私钥文件名列表（按安全优先级由高至低）
 */
const DEFAULT_KEY_FILENAMES = ["id_ed25519", "id_ecdsa", "id_rsa", "id_dsa"];

/**
 * SSH 凭证探测与配置组装器
 */
export class CredentialResolver {
  /**
   * 将输入的连接参数转换为底层 ssh2 客户端所需的 ConnectConfig
   *
   * @param params 业务层传入的 SSH 连接参数
   * @return 组装完成的 ssh2 ConnectConfig 连接选项
   */
  public async resolve(params: SSHConnectParams): Promise<ConnectConfig> {
    const username =
      params.username ||
      process.env.USER ||
      process.env.USERNAME ||
      os.userInfo().username ||
      "root";

    const config: ConnectConfig = {
      host: params.host || "localhost",
      port: params.port || 22,
      username,
      keepaliveInterval: params.keepaliveInterval ?? 10000,
      keepaliveCountMax: 3,
      readyTimeout: params.readyTimeout ?? 30000,
    };

    // 1. 若显式提供了密码
    if (params.password) {
      config.password = params.password;
    }

    // 2. 若显式提供了私钥（文件路径或内容文本）
    if (params.privateKey) {
      config.privateKey = this.readPrivateKeyContent(params.privateKey);
      if (params.passphrase) {
        config.passphrase = params.passphrase;
      }
      return config;
    }

    // 3. 若未提供密码也未显式提供私钥，按序自动探测
    if (!config.password) {
      // 3.1 尝试从本地 ~/.ssh 目录寻找默认公私钥对
      const detectedKey = this.detectDefaultPrivateKey();
      if (detectedKey) {
        config.privateKey = detectedKey;
        if (params.passphrase) {
          config.passphrase = params.passphrase;
        }
        return config;
      }

      // 3.2 尝试探测本地 SSH-Agent 套接字
      if (process.env.SSH_AUTH_SOCK) {
        config.agent = process.env.SSH_AUTH_SOCK;
      }
    }

    return config;
  }

  /**
   * 将传入的私钥参数读取为字符串或 Buffer
   *
   * @param privateKeyInput 本地私钥绝对/相对路径或 PEM 字符串
   * @return 私钥文本或原始二进制内容
   */
  private readPrivateKeyContent(privateKeyInput: string): string | Buffer {
    let targetPath = privateKeyInput;
    if (targetPath.startsWith("~/")) {
      targetPath = path.join(os.homedir(), targetPath.slice(2));
    }

    if (fs.existsSync(targetPath)) {
      try {
        const stat = fs.statSync(targetPath);
        if (stat.isFile()) {
          return fs.readFileSync(targetPath);
        }
      } catch {
        // 若读取文件失败，回退尝试视为原始文本
      }
    }

    // 若未直接包含 -----BEGIN，尝试检测是否为 Base64 编码的私钥
    if (!privateKeyInput.includes("-----BEGIN")) {
      try {
        const decoded = Buffer.from(privateKeyInput.trim(), "base64").toString("utf-8");
        if (decoded.includes("-----BEGIN")) {
          return decoded;
        }
      } catch {
        // 忽略 Base64 解码异常
      }
    }

    // 针对字面量 \n 转义字符进行换行还原
    if (privateKeyInput.includes("\\n")) {
      return privateKeyInput.replace(/\\n/g, "\n");
    }

    return privateKeyInput;
  }

  /**
   * 自动探测用户家目录下 ~/.ssh/ 存在的默认私钥
   *
   * @return 读取到的默认私钥 Buffer，未找到时返回 undefined
   */
  private detectDefaultPrivateKey(): Buffer | undefined {
    const sshDir = path.join(os.homedir(), ".ssh");
    if (!fs.existsSync(sshDir)) {
      return undefined;
    }

    for (const fileName of DEFAULT_KEY_FILENAMES) {
      const fullPath = path.join(sshDir, fileName);
      if (fs.existsSync(fullPath)) {
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile()) {
            return fs.readFileSync(fullPath);
          }
        } catch {
          // 忽略无权限或已损坏文件
        }
      }
    }

    return undefined;
  }
}
