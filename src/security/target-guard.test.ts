/**
 * 目标主机白名单 (Target Allowlist) 与禁用动态建连单元测试
 *
 * @author Ateng
 * @since 2026-10-15
 */

import { describe, expect, it } from "vitest";
import { isTargetAllowed, validateConnectionTarget } from "./target-guard.js";

describe("目标主机白名单 (Target Allowlist) 安全拦截器", () => {
  describe("isTargetAllowed 规则匹配", () => {
    it("未配置白名单规则时应默认放行全部目标", () => {
      expect(isTargetAllowed("192.168.1.1", 22)).toBe(true);
      expect(isTargetAllowed("google.com", 443, [])).toBe(true);
      expect(isTargetAllowed("10.0.0.1", 22, undefined)).toBe(true);
    });

    it("单 IP 规则匹配 (精确 IP 与端口)", () => {
      const allowlist = ["192.168.1.100", "192.168.1.200:2222"];
      expect(isTargetAllowed("192.168.1.100", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("192.168.1.100", 2222, allowlist)).toBe(true);
      expect(isTargetAllowed("192.168.1.200", 2222, allowlist)).toBe(true);
      expect(isTargetAllowed("192.168.1.200", 22, allowlist)).toBe(false); // 端口不匹配
      expect(isTargetAllowed("192.168.1.101", 22, allowlist)).toBe(false);
    });

    it("IPv4 CIDR 子网规则匹配", () => {
      const allowlist = ["10.0.0.0/8", "172.16.0.0/12:2222", "192.168.1.0/24"];
      expect(isTargetAllowed("10.1.2.3", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("10.255.255.255", 8080, allowlist)).toBe(true);
      expect(isTargetAllowed("172.16.5.1", 2222, allowlist)).toBe(true);
      expect(isTargetAllowed("172.16.5.1", 22, allowlist)).toBe(false); // 指定端口不匹配
      expect(isTargetAllowed("192.168.1.50", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("192.168.2.50", 22, allowlist)).toBe(false); // 不在 /24 网段
    });

    it("域名通配符与精确主机名规则匹配", () => {
      const allowlist = ["*.internal.corp", "bastion.example.com:2200", "myhost.local"];
      expect(isTargetAllowed("web.internal.corp", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("db.prod.internal.corp", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("external.corp", 22, allowlist)).toBe(false);
      expect(isTargetAllowed("bastion.example.com", 2200, allowlist)).toBe(true);
      expect(isTargetAllowed("bastion.example.com", 22, allowlist)).toBe(false);
      expect(isTargetAllowed("myhost.local", 22, allowlist)).toBe(true);
    });
  });

  describe("validateConnectionTarget 拦截守卫", () => {
    it("当 disableDynamicConnect 为 true 时应抛出明确的禁止异常", () => {
      expect(() =>
        validateConnectionTarget("192.168.1.100", 22, undefined, {
          disableDynamicConnect: true,
        })
      ).toThrowError(/动态建连已被管理员禁用/);
    });

    it("当目标主机未命中白名单时应抛出安全拦截异常", () => {
      expect(() =>
        validateConnectionTarget("10.0.0.1", 22, undefined, {
          allowedTargets: ["192.168.1.0/24"],
        })
      ).toThrowError(/目标主机 10.0.0.1:22 未包含在允许的目标白名单/);
    });

    it("当目标主机合法但 ProxyJump 字符串跳板机未命中白名单时应拦截", () => {
      expect(() =>
        validateConnectionTarget("192.168.1.100", 22, "jump@10.0.0.1:22", {
          allowedTargets: ["192.168.1.0/24"],
        })
      ).toThrowError(/跳板机 .* 未包含在允许的目标白名单/);
    });

    it("当目标主机与 ProxyJump 结构体跳板机均在白名单中时应放行通过", () => {
      expect(() =>
        validateConnectionTarget(
          "192.168.1.100",
          22,
          { host: "192.168.1.254", port: 2222 },
          {
            allowedTargets: ["192.168.1.0/24"],
          }
        )
      ).not.toThrow();
    });
  });
});
