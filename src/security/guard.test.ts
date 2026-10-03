/**
 * SafetyGuard 安全拦截守卫单元测试
 *
 * @author Ateng
 * @since 2026-10-03
 */

import { describe, expect, it } from "vitest";
import { SafetyGuard } from "./guard.js";

describe("SafetyGuard 致命破坏命令拦截守卫", () => {
  const guard = new SafetyGuard();

  describe("根目录与全盘强删拦截", () => {
    it.each([
      "rm -rf /",
      "rm -fr /",
      "rm -rf /*",
      "rm -rf / --no-preserve-root",
      "rm --no-preserve-root -rf /",
      "sudo rm -rf /",
      "sudo rm -rf /*",
      "rm -rf /var/..",
      "rm -rf .",
    ])("应当成功阻断高危删除命令: %s", (cmd) => {
      const result = guard.check(cmd);
      expect(result.isAllowed).toBe(false);
      expect(result.matchedRule).toBeDefined();
      expect(result.matchedRule?.id).toContain("lethal-rm");
      expect(() => guard.assertSafe(cmd)).toThrow();
    });

    it("应当放行常规安全的目录删除操作", () => {
      expect(guard.check("rm -rf /tmp/my-temp-dir").isAllowed).toBe(true);
      expect(guard.check("rm -f test.log").isAllowed).toBe(true);
      expect(guard.check("rm -rf ./build/dist").isAllowed).toBe(true);
    });
  });

  describe("块设备格式化与底层覆写拦截", () => {
    it.each([
      "mkfs.ext4 /dev/sda1",
      "mkfs.xfs /dev/nvme0n1p1",
      "sudo mkfs /dev/vda",
      "dd if=/dev/zero of=/dev/sda bs=1M",
      "dd if=/dev/urandom of=/dev/nvme0n1",
      "> /dev/sda",
    ])("应当成功阻断磁盘与块设备破坏命令: %s", (cmd) => {
      const result = guard.check(cmd);
      expect(result.isAllowed).toBe(false);
      expect(() => guard.assertSafe(cmd)).toThrow();
    });

    it("应当放行常规向普通文件写入的 dd 命令", () => {
      expect(guard.check("dd if=/dev/zero of=./testfile.img bs=1M count=10").isAllowed).toBe(true);
    });
  });

  describe("系统关机与停机拦截", () => {
    it.each([
      "reboot",
      "sudo reboot",
      "shutdown -h now",
      "shutdown -r now",
      "poweroff",
      "init 0",
      "init 6",
      "halt",
    ])("应当成功阻断系统关机停机命令: %s", (cmd) => {
      const result = guard.check(cmd);
      expect(result.isAllowed).toBe(false);
      expect(result.matchedRule?.id).toContain("shutdown-reboot");
    });

    it("应当放行包含 shutdown 或 reboot 词汇的普通文本或查询", () => {
      expect(guard.check("grep -i 'reboot' /var/log/syslog").isAllowed).toBe(true);
      expect(guard.check("echo 'system will not reboot'").isAllowed).toBe(true);
    });
  });

  describe("Fork 炸弹拦截", () => {
    it.each([
      ":(){ :|:& };:",
      ":(){ :|:& }; :",
      ":() { :|:& };:",
    ])("应当成功阻断 Bash Fork 炸弹: %s", (cmd) => {
      const result = guard.check(cmd);
      expect(result.isAllowed).toBe(false);
      expect(result.matchedRule?.id).toContain("fork-bomb");
    });
  });

  describe("权限毁灭清空拦截", () => {
    it.each([
      "chmod -R 000 /",
      "chmod 000 /",
      "chmod -R 0 /",
    ])("应当成功阻断根目录权限清空命令: %s", (cmd) => {
      const result = guard.check(cmd);
      expect(result.isAllowed).toBe(false);
    });
  });

  describe("自定义黑名单与白名单覆盖", () => {
    it("应当支持通过配置追加自定义黑名单规则", () => {
      const customGuard = new SafetyGuard({
        extraRules: [
          {
            id: "block-custom-npm",
            name: "禁止执行 npm publish",
            description: "生产环境禁止执行 npm 发布命令",
            pattern: "^npm\\s+publish",
            severity: "high",
            enabled: true,
          },
        ],
      });

      expect(customGuard.check("npm publish").isAllowed).toBe(false);
      expect(customGuard.check("npm test").isAllowed).toBe(true);
    });

    it("应当支持通过白名单放行特定匹配的命令", () => {
      const customGuard = new SafetyGuard({
        whitelistPatterns: ["^sudo\\s+reboot\\s+--force-allow$"],
      });

      // 默认拦截
      expect(customGuard.check("sudo reboot").isAllowed).toBe(false);
      // 白名单特权放行
      expect(customGuard.check("sudo reboot --force-allow").isAllowed).toBe(true);
    });
  });
});
