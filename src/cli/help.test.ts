/**
 * CLI 帮助文档测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it } from "vitest";
import { getHelpText, SERVICE_VERSION } from "./help.js";

describe("CLI 帮助文档 (getHelpText)", () => {
  it("帮助手册应包含版本号、标准用法与所有核心选项", () => {
    const text = getHelpText();

    expect(text).toContain(`mcp-server-ssh v${SERVICE_VERSION}`);
    expect(text).toContain("mcp-server-ssh [选项]");
    expect(text).toContain("-h, --help");
    expect(text).toContain("-v, --version");
    expect(text).toContain("--doctor");
    expect(text).toContain("--server-name");
    expect(text).toContain("--server-instructions");
  });

  it("帮助手册应完整罗列规范环境变量与能力矩阵", () => {
    const text = getHelpText();

    expect(text).toContain("MCP_SSH_HOST");
    expect(text).toContain("MCP_SSH_PORT");
    expect(text).toContain("MCP_SSH_USER");
    expect(text).toContain("MCP_SSH_PRIVATE_KEY_PATH");
    expect(text).toContain("MCP_SSH_SERVER_NAME");
    expect(text).toContain("MCP_SSH_SERVER_INSTRUCTIONS");
    expect(text).toContain("MCP_SSH_ALLOW_DANGEROUS_COMMANDS");
    expect(text).toContain("MCP_SSH_AUDIT_LOG_PATH");
    expect(text).toContain("共 29 项原子工具");
  });
});

