/**
 * CLI 四维全景自检排障套件 (Self-Inspection Doctor)
 *
 * 覆盖 Runtime 运行时、本地 OpenSSH 密钥链、配置合规性与目标连通性探测 (ADR-0013)
 *
 * @author Ateng
 * @since 2026-10-14
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ConnectionPool } from "../connection/pool.js";
import { getPreConnectParams, parseEnv } from "../config/env.js";

/**
 * 诊断检查单项状态
 */
export type DoctorStatus = "PASS" | "WARN" | "FAIL";

/**
 * 诊断检查项结果
 */
export interface DoctorCheckItem {
  category: string;
  name: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

/**
 * 诊断套件汇总结果
 */
export interface DoctorResult {
  success: boolean;
  checks: DoctorCheckItem[];
  output: string;
}

/**
 * 诊断选项
 */
export interface DoctorOptions {
  env?: NodeJS.ProcessEnv;
  probeTimeoutMs?: number;
  connectionPool?: ConnectionPool;
}

/**
 * 运行四维全景自检排障套件
 *
 * @param options 诊断参数选项
 * @return 包含各项状态与汇总文本的诊断结果
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const env = options.env ?? process.env;
  const probeTimeout = options.probeTimeoutMs ?? 5000;
  const checks: DoctorCheckItem[] = [];

  // ==========================================
  // 维度 1: Runtime 宿主与运行环境
  // ==========================================
  const nodeVersion = process.versions.node;
  const majorVersion = parseInt(nodeVersion.split(".")[0], 10);
  if (majorVersion >= 18) {
    checks.push({
      category: "Runtime 运行时",
      name: "Node.js 版本",
      status: "PASS",
      message: `Node.js v${nodeVersion} 满足环境要求 (>= 18.0.0)`,
    });
  } else {
    checks.push({
      category: "Runtime 运行时",
      name: "Node.js 版本",
      status: "FAIL",
      message: `当前 Node.js v${nodeVersion} 版本过低，服务要求 Node.js >= 18.0.0`,
    });
  }

  checks.push({
    category: "Runtime 运行时",
    name: "操作系统平台",
    status: "PASS",
    message: `${os.type()} (${os.platform()} ${os.arch()}), Node ABI: ${process.versions.modules}`,
  });

  // ==========================================
  // 维度 2: 本地 OpenSSH 资产与凭据生态
  // ==========================================
  const homeDir = os.homedir();
  const sshConfigPath = path.join(homeDir, ".ssh", "config");
  if (fs.existsSync(sshConfigPath)) {
    try {
      fs.accessSync(sshConfigPath, fs.constants.R_OK);
      checks.push({
        category: "本地 OpenSSH 资产",
        name: "SSH 配置文件",
        status: "PASS",
        message: `~/.ssh/config 文件存在且具备可读权限 (${sshConfigPath})`,
      });
    } catch {
      checks.push({
        category: "本地 OpenSSH 资产",
        name: "SSH 配置文件",
        status: "WARN",
        message: `~/.ssh/config 文件存在但无读取权限，别名解析可能受限`,
      });
    }
  } else {
    checks.push({
      category: "本地 OpenSSH 资产",
      name: "SSH 配置文件",
      status: "WARN",
      message: `未检测到 ~/.ssh/config 配置文件（可选，不影响 IP/主机名直连）`,
    });
  }

  const defaultKeyNames = ["id_ed25519", "id_ecdsa", "id_rsa"];
  const foundKeys: string[] = [];
  for (const keyName of defaultKeyNames) {
    const keyPath = path.join(homeDir, ".ssh", keyName);
    if (fs.existsSync(keyPath)) {
      foundKeys.push(keyName);
    }
  }

  if (foundKeys.length > 0) {
    checks.push({
      category: "本地 OpenSSH 资产",
      name: "默认本地私钥",
      status: "PASS",
      message: `在 ~/.ssh/ 探测到本地默认私钥: ${foundKeys.join(", ")}`,
    });
  } else {
    checks.push({
      category: "本地 OpenSSH 资产",
      name: "默认本地私钥",
      status: "WARN",
      message: `~/.ssh/ 目录下未发现标准默认私钥，如需密钥鉴权需配置 MCP_SSH_PRIVATE_KEY_PATH`,
    });
  }

  const agentSock = env.SSH_AUTH_SOCK;
  if (agentSock) {
    checks.push({
      category: "本地 OpenSSH 资产",
      name: "SSH Agent 转发通道",
      status: "PASS",
      message: `SSH_AUTH_SOCK 处于活跃挂载状态 (${agentSock})`,
    });
  } else {
    checks.push({
      category: "本地 OpenSSH 资产",
      name: "SSH Agent 转发通道",
      status: "WARN",
      message: `未检测到 SSH_AUTH_SOCK 环境变量（SSH Agent 代理认证未启用）`,
    });
  }

  // ==========================================
  // 维度 3: 服务环境变量配置与规范校验
  // ==========================================
  let parsedConfig: ReturnType<typeof parseEnv> | undefined;
  try {
    parsedConfig = parseEnv(env);
    checks.push({
      category: "环境变量配置",
      name: "规范配置解析 (ADR-0012)",
      status: "PASS",
      message: `环境变量解析强校验通过 (传输模式: ${parsedConfig.transport}, 超时: ${parsedConfig.timeoutMs}ms)`,
    });

    // 3.2 安全审计合规性检查 (ADR-0014)
    if (parsedConfig.audit.enabled) {
      if (parsedConfig.audit.logPath) {
        const logDir = path.dirname(parsedConfig.audit.logPath);
        let writeable = true;
        try {
          // 纯只读探针：溯源至已存在的最近祖先目录检测写入权限，杜绝产生物理创建副作用
          let targetDir = logDir;
          while (!fs.existsSync(targetDir)) {
            const parent = path.dirname(targetDir);
            if (parent === targetDir) {
              break;
            }
            targetDir = parent;
          }
          fs.accessSync(targetDir, fs.constants.W_OK);
        } catch {
          writeable = false;
        }


        if (writeable) {
          checks.push({
            category: "环境变量配置",
            name: "安全审计轨迹 (ADR-0014)",
            status: "PASS",
            message: `安全审计已激活 (路径: ${parsedConfig.audit.logPath}, 切分上限: ${parsedConfig.audit.maxSizeMb}MB, 保留: ${parsedConfig.audit.maxFiles}份, 模式: ${parsedConfig.audit.strict ? "严格熔断" : "柔性降级"})`,
          });
        } else {
          checks.push({
            category: "环境变量配置",
            name: "安全审计轨迹 (ADR-0014)",
            status: parsedConfig.audit.strict ? "FAIL" : "WARN",
            message: `安全审计日志目录不可写或无权限创建: ${logDir}`,
          });
        }
      } else {
        checks.push({
          category: "环境变量配置",
          name: "安全审计轨迹 (ADR-0014)",
          status: "PASS",
          message: `安全审计已激活 (输出目标: 标准错误流 stderr, 模式: ${parsedConfig.audit.strict ? "严格熔断" : "柔性降级"})`,
        });
      }
    } else {
      checks.push({
        category: "环境变量配置",
        name: "安全审计轨迹 (ADR-0014)",
        status: "PASS",
        message: "安全审计处于未启用状态 (MCP_SSH_AUDIT_ENABLED=false)",
      });
    }

    // 3.3 多实例服务身份与引导指示 (ADR-0015)
    checks.push({
      category: "环境变量配置",
      name: "服务身份标识 (ADR-0015)",
      status: "PASS",
      message: `服务标识名称: "${parsedConfig.serverName}"${
        parsedConfig.serverInstructions ? ` (已注入自定义引导指示: ${parsedConfig.serverInstructions.length} 字符)` : " (未配置额外引导指示)"
      }`,
    });
  } catch (err) {
    checks.push({
      category: "环境变量配置",
      name: "规范配置解析 (ADR-0012)",
      status: "FAIL",
      message: `环境变量存在非法或模糊输入: ${err instanceof Error ? err.message : String(err)}`,
    });
  }


  // ==========================================
  // 维度 4: 默认目标主机网络与 SSH 连通性探测
  // ==========================================
  if (parsedConfig?.target && (parsedConfig.target.host || parsedConfig.target.sshConfigAlias)) {
    const targetLabel = parsedConfig.target.sshConfigAlias || parsedConfig.target.host;
    const targetPort = parsedConfig.target.port || 22;
    const targetHost = parsedConfig.target.host;

    // 4.1 TCP 端口可达性探测 (若有明确 host)
    if (targetHost) {
      const tcpStart = Date.now();
      const tcpPass = await new Promise<boolean>((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(probeTimeout);
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("timeout", () => {
          socket.destroy();
          resolve(false);
        });
        socket.once("error", () => {
          socket.destroy();
          resolve(false);
        });
        socket.connect(targetPort, targetHost);
      });

      const tcpLatency = Date.now() - tcpStart;
      if (tcpPass) {
        checks.push({
          category: "目标主机连通性",
          name: "TCP 端口可达性",
          status: "PASS",
          message: `目标 ${targetHost}:${targetPort} TCP 端口畅通 (往返延迟: ${tcpLatency}ms)`,
        });
      } else {
        checks.push({
          category: "目标主机连通性",
          name: "TCP 端口可达性",
          status: "FAIL",
          message: `无法在 ${probeTimeout}ms 内连接目标 ${targetHost}:${targetPort} (网络不可达、端口未开放或防火墙拦截)`,
        });
      }
    }

    // 4.2 SSH 协议通道与握手探测
    const preConnect = getPreConnectParams(parsedConfig);
    if (preConnect) {
      const pool = options.connectionPool ?? new ConnectionPool();
      const sshStart = Date.now();
      try {
        const connectParams = {
          ...preConnect,
          readyTimeout: probeTimeout,
        };
        const connInfo = await pool.connect(connectParams);
        const sshLatency = Date.now() - sshStart;
        checks.push({
          category: "目标主机连通性",
          name: "SSH 握手与鉴权",
          status: "PASS",
          message: `成功与远程主机建立物理连接并完成身份认证 (${connInfo.host}, 耗时: ${sshLatency}ms)`,
        });
        await pool.disconnect(connInfo.connectionId);
      } catch (err) {
        checks.push({
          category: "目标主机连通性",
          name: "SSH 握手与鉴权",
          status: "FAIL",
          message: `SSH 建立物理连接失败: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  } else {
    checks.push({
      category: "目标主机连通性",
      name: "预建连目标配置",
      status: "PASS",
      message: `未配置 MCP_SSH_HOST，服务当前工作在按需动态建连模式 (等待客户端发起 ssh_connect)`,
    });
  }

  // 格式化输出报告
  const passCount = checks.filter((c) => c.status === "PASS").length;
  const warnCount = checks.filter((c) => c.status === "WARN").length;
  const failCount = checks.filter((c) => c.status === "FAIL").length;
  const success = failCount === 0;

  const lines: string[] = [];
  lines.push("=================================================");
  lines.push("   mcp-server-ssh 全景自检排障套件 (Doctor)     ");
  lines.push("=================================================");
  lines.push("");

  let currentCategory = "";
  for (const check of checks) {
    if (check.category !== currentCategory) {
      currentCategory = check.category;
      lines.push(`[${currentCategory}]`);
    }
    const badge =
      check.status === "PASS"
        ? "  \x1b[32m[PASS]\x1b[0m"
        : check.status === "WARN"
        ? "  \x1b[33m[WARN]\x1b[0m"
        : "  \x1b[31m[FAIL]\x1b[0m";
    lines.push(`${badge} ${check.name}: ${check.message}`);
    if (check.detail) {
      lines.push(`         ${check.detail}`);
    }
  }

  lines.push("");
  lines.push("-------------------------------------------------");
  const summaryColor = success ? "\x1b[32m" : "\x1b[31m";
  lines.push(
    `诊断结果: ${summaryColor}${passCount} 项通过\x1b[0m, ${warnCount} 项提示, ${
      failCount > 0 ? `\x1b[31m${failCount} 项失败\x1b[0m` : "0 项失败"
    }`
  );
  if (!success) {
    lines.push("\x1b[31m提示: 请根据上述 [FAIL] 标记排查环境变量配置或目标主机网络安全组策略。\x1b[0m");
  }
  lines.push("=================================================");

  const output = lines.join("\n");
  return {
    success,
    checks,
    output,
  };
}
