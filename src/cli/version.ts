/**
 * 服务语义化版本统一管理中枢
 *
 * 建立 package.json 单一真实信源，彻底杜绝多模块版本号硬编码与漂移
 *
 * @author Ateng
 * @since 2026-10-15
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 动态探测并读取当前发布的版本号
 *
 * @return 语义化版本号字符串 (如 "1.4.0")
 */
export function getPackageVersion(): string {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    let dir = currentDir;
    for (let i = 0; i < 5; i++) {
      const pkgPath = path.join(dir, "package.json");
      if (fs.existsSync(pkgPath)) {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const pkg = JSON.parse(content);
        if (typeof pkg.version === "string" && pkg.version.trim() !== "") {
          return pkg.version.trim();
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        break;
      }
      dir = parent;
    }
  } catch {
    // 异常情况下安全回退
  }
  return "1.4.0";
}

export const SERVICE_VERSION = getPackageVersion();
