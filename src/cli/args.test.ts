/**
 * CLI 参数解析单元测试
 *
 * @author Ateng
 * @since 2026-10-14
 */

import { describe, expect, it } from "vitest";
import { parseCLIArgs } from "./args.js";

describe("CLI 参数解析 (parseCLIArgs)", () => {
  it("默认无参数输入时所有标志应为 false", () => {
    const opts = parseCLIArgs([]);
    expect(opts.help).toBe(false);
    expect(opts.version).toBe(false);
    expect(opts.doctor).toBe(false);
  });

  it("应正确解析 --help 与 -h 标志", () => {
    expect(parseCLIArgs(["--help"]).help).toBe(true);
    expect(parseCLIArgs(["-h"]).help).toBe(true);
  });

  it("应正确解析 --version 与 -v 标志", () => {
    expect(parseCLIArgs(["--version"]).version).toBe(true);
    expect(parseCLIArgs(["-v"]).version).toBe(true);
  });

  it("应正确解析 --doctor 标志", () => {
    expect(parseCLIArgs(["--doctor"]).doctor).toBe(true);
  });

  it("多标志混入与未知参数应安全容错", () => {
    const opts = parseCLIArgs(["--help", "--unknown-flag", "extra-arg"]);
    expect(opts.help).toBe(true);
    expect(opts.version).toBe(false);
    expect(opts.doctor).toBe(false);
  });

  it("应正确解析 --server-name 与 --server-instructions 字符串选项", () => {
    const opts1 = parseCLIArgs(["--server-name", "prod-bastion"]);
    expect(opts1.serverName).toBe("prod-bastion");
    expect(opts1.serverInstructions).toBeUndefined();

    const opts2 = parseCLIArgs([
      "--server-name=gpu-cluster",
      "--server-instructions=用于连接算力节点，请勿执行关机命令",
    ]);
    expect(opts2.serverName).toBe("gpu-cluster");
    expect(opts2.serverInstructions).toBe("用于连接算力节点，请勿执行关机命令");
  });

  it("应支持 doctor、version、help 位置子命令并映射为对应标志", () => {
    expect(parseCLIArgs(["doctor"]).doctor).toBe(true);
    expect(parseCLIArgs(["version"]).version).toBe(true);
    expect(parseCLIArgs(["help"]).help).toBe(true);
  });
});

