/**
 * OpenSSH 风格配置文件 (~/.ssh/config) 解析器
 *
 * @author Ateng
 * @since 2026-10-03
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import SSHConfig from "ssh-config";
import type { SSHConnectParams } from "../types/connection.js";

/**
 * 主机别名配置概要
 */
export interface ConfiguredHostSummary {
  alias: string;
  hostName?: string;
  user?: string;
  port?: number;
  proxyJump?: string;
}

/**
 * SSH 配置文件解析与别名查找器
 */
export class SSHConfigParser {
  private config: any;

  /**
   * 初始化 SSH 配置解析器
   *
   * @param configContent 可选的配置文件文本内容；若未传入则默认读取本地 ~/.ssh/config 文件
   */
  constructor(configContent?: string) {
    if (configContent !== undefined) {
      this.config = SSHConfig.parse(configContent);
    } else {
      const defaultPath = path.join(os.homedir(), ".ssh", "config");
      if (fs.existsSync(defaultPath)) {
        try {
          const content = fs.readFileSync(defaultPath, "utf-8");
          this.config = SSHConfig.parse(content);
        } catch {
          this.config = SSHConfig.parse("");
        }
      } else {
        this.config = SSHConfig.parse("");
      }
    }
  }

  /**
   * 列出所有明确命名（非通配符）的 Host 别名列表
   *
   * @return 明确配置的主机别名摘要列表（无匹配时返回空列表）
   */
  public listHosts(): ConfiguredHostSummary[] {
    const results: ConfiguredHostSummary[] = [];
    if (!this.config) {
      return results;
    }

    for (const entry of this.config) {
      if (entry.param === "Host" && entry.value && typeof entry.value === "string") {
        // 排除全局通配符 *
        if (entry.value.trim() !== "*") {
          const computed = this.config.compute(entry.value);
          results.push({
            alias: entry.value.trim(),
            hostName: computed.HostName,
            user: computed.User,
            port: computed.Port ? Number.parseInt(String(computed.Port), 10) : undefined,
            proxyJump: computed.ProxyJump,
          });
        }
      }
    }

    return results;
  }

  /**
   * 根据别名解析出完整的连接参数配置
   *
   * @param alias 目标主机别名（如 "prod-api"）
   * @return 完整的 SSHConnectParams，若未找到对应配置则返回 null
   */
  public resolveHost(alias: string): SSHConnectParams | null {
    if (!this.config) {
      return null;
    }

    // 检查是否存在匹配的主机块
    const directEntry = this.config.find({ Host: alias });
    if (!directEntry) {
      return null;
    }

    const computed = this.config.compute(alias);
    const host = computed.HostName || alias;
    const port = computed.Port ? Number.parseInt(String(computed.Port), 10) : 22;
    const username = computed.User;
    const identityFile = Array.isArray(computed.IdentityFile)
      ? computed.IdentityFile[0]
      : computed.IdentityFile;
    const proxyJump = computed.ProxyJump;

    // 解析 ~ 路径
    let resolvedPrivateKey: string | undefined = identityFile;
    if (resolvedPrivateKey && resolvedPrivateKey.startsWith("~/")) {
      resolvedPrivateKey = path.join(os.homedir(), resolvedPrivateKey.slice(2));
    }

    return {
      host,
      port,
      username,
      privateKey: resolvedPrivateKey,
      proxyJump,
      sshConfigAlias: alias,
      setAsDefault: true,
    };
  }
}
