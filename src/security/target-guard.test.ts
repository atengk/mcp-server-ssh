/**
 * 目标主机白名单 (Target Allowlist) 与禁用动态建连单元测试
 *
 * @author Ateng
 * @since 2026-10-15
 */

import { describe, expect, it } from "vitest";
import {
  assertFailClosedBinding,
  isLoopbackHost,
  isTargetAllowed,
  validateConnectionTarget,
} from "./target-guard.js";

describe("目标主机白名单 (Target Allowlist) 与网络安全守卫", () => {
  describe("isLoopbackHost 回环地址判定", () => {
    it("正确识别 IPv4、IPv6 与 localhost 回环地址", () => {
      expect(isLoopbackHost("localhost")).toBe(true);
      expect(isLoopbackHost("127.0.0.1")).toBe(true);
      expect(isLoopbackHost("127.0.1.1")).toBe(true);
      expect(isLoopbackHost("::1")).toBe(true);
      expect(isLoopbackHost("[::1]")).toBe(true);
    });

    it("正确将非回环地址判定为 false", () => {
      expect(isLoopbackHost("0.0.0.0")).toBe(false);
      expect(isLoopbackHost("192.168.1.100")).toBe(false);
      expect(isLoopbackHost("example.com")).toBe(false);
      expect(isLoopbackHost("::")).toBe(false);
    });
  });

  describe("assertFailClosedBinding 强制熔断守卫", () => {
    it("当绑定回环且未提供 Token 时应放行通过", () => {
      expect(() => assertFailClosedBinding("127.0.0.1")).not.toThrow();
      expect(() => assertFailClosedBinding("localhost", undefined)).not.toThrow();
    });

    it("当绑定非回环且未提供 Token 时必须抛出安全熔断致命异常", () => {
      expect(() => assertFailClosedBinding("0.0.0.0")).toThrowError(/安全熔断.*Fail-Closed/);
      expect(() => assertFailClosedBinding("192.168.1.10")).toThrowError(/安全熔断.*Fail-Closed/);
    });

    it("当绑定非回环但配置了有效 Token 时应放行通过", () => {
      expect(() => assertFailClosedBinding("0.0.0.0", "secret-token")).not.toThrow();
      expect(() => assertFailClosedBinding("192.168.1.10", "my-token")).not.toThrow();
    });
  });

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

    it("IPv6 与 IPv6 CIDR 网段规则匹配", () => {
      const allowlist = ["2001:db8::/32", "[::1]:2222"];
      expect(isTargetAllowed("2001:db8:abcd::1", 22, allowlist)).toBe(true);
      expect(isTargetAllowed("2001:db9::1", 22, allowlist)).toBe(false);
      expect(isTargetAllowed("::1", 2222, allowlist)).toBe(true);
      expect(isTargetAllowed("::1", 22, allowlist)).toBe(false); // 端口不匹配
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
    it("当 disableDynamicConnect 为 true 时应拦截直接主机建连", () => {
      expect(() =>
        validateConnectionTarget("192.168.1.100", 22, undefined, {
          disableDynamicConnect: true,
        })
      ).toThrowError(/动态建连已被管理员禁用/);
    });

    it("当 disableDynamicConnect 为 true 且 isConfigAlias 为 true 时应豁免放行 (ADR-0017)", () => {
      expect(() =>
        validateConnectionTarget("192.168.1.100", 22, undefined, {
          disableDynamicConnect: true,
          isConfigAlias: true,
        })
      ).not.toThrow();
    });

    it("当 isConfigAlias 为 true 但主机未命中白名单时应依然被白名单拦截", () => {
      expect(() =>
        validateConnectionTarget("10.0.0.1", 22, undefined, {
          disableDynamicConnect: true,
          isConfigAlias: true,
          allowedTargets: ["192.168.1.0/24"],
        })
      ).toThrowError(/目标主机 10.0.0.1:22 未包含在允许的目标白名单/);
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
