/**
 * tsup 单文件打包构建配置
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: true,
  splitting: false,
  bundle: true,
  banner: {
    js: "#!/usr/bin/env node",
  },
});
