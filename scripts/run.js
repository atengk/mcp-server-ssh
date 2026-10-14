#!/usr/bin/env node
/**
 * 跨平台 Shell 脚本调度执行器
 *
 * 在不同操作系统（Linux / macOS / Windows）下透明调度 scripts/ 目录下的 Bash 脚本。
 * 在 Windows 环境下优先定位 Git 内置的 bash.exe，自动规避 WSL 默认未初始化环境的拦截冲突。
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 在 Windows 平台安全探测 Git Bash 执行程序物理路径
 *
 * @returns {string} 可用的 bash.exe 路径，未探测到时降级返回 "bash"
 */
function findWindowsBash() {
  // 1. 优先读取显式环境变量
  if (process.env.GIT_BASH_PATH && fs.existsSync(process.env.GIT_BASH_PATH)) {
    return process.env.GIT_BASH_PATH;
  }

  // 2. 基于 git --exec-path 反向推导 Git 安装根目录
  try {
    const execPath = execSync('git --exec-path', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (execPath) {
      const candidate = path.resolve(execPath, '../../..', 'bin', 'bash.exe');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      const candidateUsr = path.resolve(execPath, '../../..', 'usr', 'bin', 'bash.exe');
      if (fs.existsSync(candidateUsr)) {
        return candidateUsr;
      }
    }
  } catch {
    // 忽略推导异常，降级到默认路径检索
  }

  // 3. 常见默认安装路径排查
  const standardPaths = [
    'C:\\Program Files\\Git\\bin\\bash.exe',
    'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
    'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
  ];

  for (const stdPath of standardPaths) {
    if (stdPath && fs.existsSync(stdPath)) {
      return stdPath;
    }
  }

  // 4. 兜底返回系统 PATH 中的 bash
  return 'bash';
}

function main() {
  const scriptName = process.argv[2];
  if (!scriptName) {
    console.error('[run.js] 错误: 未指定拟执行的脚本名称，用法: node scripts/run.js <script-name.sh> [...args]');
    process.exit(1);
  }

  const scriptPath = path.resolve(__dirname, scriptName);
  if (!fs.existsSync(scriptPath)) {
    console.error(`[run.js] 错误: 目标脚本文件不存在: ${scriptPath}`);
    process.exit(1);
  }

  const scriptArgs = process.argv.slice(3);
  const isWindows = process.platform === 'win32';
  const bashExecutable = isWindows ? findWindowsBash() : 'bash';

  const result = spawnSync(bashExecutable, [scriptPath, ...scriptArgs], {
    stdio: 'inherit',
    cwd: path.resolve(__dirname, '..'),
    env: process.env,
  });

  if (result.error) {
    console.error(`[run.js] 启动脚本失败: ${result.error.message}`);
    process.exit(1);
  }

  process.exit(result.status ?? 0);
}

main();
