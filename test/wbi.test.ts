import { describe, expect, it } from "vitest";
import { getMixinKey, signWbi } from "@/src/bilibili/wbi";

describe("wbi", () => {
  it("derives a 32 character mixin key", () => {
    expect(getMixinKey("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789+/")).toHaveLength(32);
  });

  it("does not throw on unexpectedly short key material", () => {
    expect(() => getMixinKey("short")).not.toThrow();
    expect(typeof getMixinKey("short")).toBe("string");
  });

  it("adds wts and w_rid to signed queries", () => {
    const query = signWbi({ mid: 123, keyword: "a!'()*b" }, { imgKey: "abcdefghijklmnopqrstuvwxyz123456", subKey: "ABCDEFGHIJKLMNOPQRSTUVWXYZ654321" });
    expect(query).toContain("mid=123");
    expect(query).toContain("keyword=ab");
    expect(query).toContain("wts=");
    expect(query).toContain("w_rid=");
  });
});
