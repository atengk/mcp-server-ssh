#!/usr/bin/env bash
# ==============================================================================
# 本地工程化开发环境一键初始化与 Git 提交守门钩子配置脚本
#
# 自动检测本地开发环境依赖（Node.js >= 18、Git、npm/pnpm），
# 激活仓库内置 Git Hooks（.githooks/commit-msg），并提供开发三板斧就绪引导。
#
# @author Ateng
# @since 2026-10-14
# ==============================================================================

set -eo pipefail

# 终端色彩定义
if [ -t 1 ]; then
  COLOR_RESET="\033[0m"
  COLOR_BOLD="\033[1m"
  COLOR_GREEN="\033[32m"
  COLOR_BLUE="\033[34m"
  COLOR_YELLOW="\033[33m"
  COLOR_RED="\033[31m"
  COLOR_CYAN="\033[36m"
else
  COLOR_RESET=""
  COLOR_BOLD=""
  COLOR_GREEN=""
  COLOR_BLUE=""
  COLOR_YELLOW=""
  COLOR_RED=""
  COLOR_CYAN=""
fi

log_info() {
  printf "%b[INFO]%b %s\n" "${COLOR_BLUE}" "${COLOR_RESET}" "$1"
}

log_success() {
  printf "%b[SUCCESS]%b %s\n" "${COLOR_GREEN}" "${COLOR_RESET}" "$1"
}

log_warn() {
  printf "%b[WARN]%b %s\n" "${COLOR_YELLOW}" "${COLOR_RESET}" "$1"
}

log_error() {
  printf "%b[ERROR]%b %s\n" "${COLOR_RED}" "${COLOR_RESET}" "$1"
}

printf "\n%b%s%b\n" "${COLOR_BOLD}${COLOR_CYAN}" "========================================================" "${COLOR_RESET}"
printf "%b%s%b\n" "${COLOR_BOLD}${COLOR_CYAN}" "  🚀 @atengk/mcp-server-ssh 本地开发环境初始化向导" "${COLOR_RESET}"
printf "%b%s%b\n\n" "${COLOR_BOLD}${COLOR_CYAN}" "========================================================" "${COLOR_RESET}"

# 1. 检查 Git 仓库环境
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log_error "当前目录并非有效的 Git 仓库，无法继续配置。"
  exit 1
fi
log_success "Git 仓库检测通过"

# 2. 配置本地 Git Hooks 路径
if [ -d ".githooks" ]; then
  git config core.hooksPath .githooks
  log_success "Git Hooks 路径已成功绑定至 .githooks (激活 Conventional Commits 提交守门)"
else
  log_warn "未检测到 .githooks 目录，跳过 Git Hooks 配置"
fi

# 3. 检查 Node.js 运行时版本 (要求 >= 18)
if ! command -v node >/dev/null 2>&1; then
  log_error "未检测到 Node.js，本项目需要 Node.js >= 18.0.0，请先安装 Node.js (https://nodejs.org/)"
  exit 1
fi

NODE_VERSION=$(node -v | tr -d 'v')
NODE_MAJOR=$(echo "${NODE_VERSION}" | cut -d'.' -f1)

if [ "${NODE_MAJOR}" -lt 18 ]; then
  log_error "检测到当前 Node.js 版本为 v${NODE_VERSION}，本项目严格要求 Node.js >= 18.0.0，请升级后重试。"
  exit 1
else
  log_success "Node.js 运行时就绪: v${NODE_VERSION}"
fi

# 4. 检查包管理器
PACKAGE_MANAGER="npm"
if command -v pnpm >/dev/null 2>&1; then
  PACKAGE_MANAGER="pnpm"
fi
log_info "检测到主包管理器: ${PACKAGE_MANAGER}"

# 5. 检查 node_modules 依赖完整性
if [ ! -d "node_modules" ]; then
  log_warn "未检测到 node_modules 依赖目录，正在执行依赖安装..."
  if [ "${PACKAGE_MANAGER}" = "pnpm" ]; then
    pnpm install
  else
    npm install
  fi
  log_success "项目依赖安装完成"
else
  log_success "项目依赖 node_modules 已就绪"
fi

# 6. 输出就绪指引
printf "\n%b%s%b\n" "${COLOR_BOLD}${COLOR_GREEN}" "========================================================" "${COLOR_RESET}"
printf "%b%s%b\n" "${COLOR_BOLD}${COLOR_GREEN}" "  ✨ 开发环境初始化完成！常用开发命令如下：" "${COLOR_RESET}"
printf "%b%s%b\n" "${COLOR_BOLD}${COLOR_GREEN}" "========================================================" "${COLOR_RESET}"
printf "  %bnpm run dev%b       : 启动 TypeScript 源码热重载监听构建\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "  %bnpm run typecheck%b : 运行全量 TypeScript 静态类型检查\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "  %bnpm test%b          : 运行全量 Vitest 单元测试套件\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "  %bnpm run build%b     : 打包生成独立 Node.js 单文件 Bundle (dist/index.js)\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "  %bnpm run commit%b    : 启动 Conventional Commits 规范化交互式提交助手\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "  %bnpm run release%b   : 启动 5 重防呆自检的语义化版本发版向导\n" "${COLOR_CYAN}" "${COLOR_RESET}"
printf "%b%s%b\n\n" "${COLOR_BOLD}${COLOR_GREEN}" "========================================================" "${COLOR_RESET}"
