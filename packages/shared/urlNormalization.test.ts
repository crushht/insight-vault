import { describe, expect, it } from "vitest";

import { isSameUrlForDedup, normalizeUrlForDedup } from "./urlNormalization";

describe("normalizeUrlForDedup", () => {
  it("strips tracking params", () => {
    expect(
      normalizeUrlForDedup(
        "https://example.com/a?utm_source=x&utm_medium=y&id=3",
      ),
    ).toBe("https://example.com/a?id=3");
  });

  it("strips chinese-platform tracking params", () => {
    expect(
      normalizeUrlForDedup(
        "https://www.bilibili.com/video/BV1xx?spm_id_from=333.999&vd_source=abc",
      ),
    ).toBe("https://www.bilibili.com/video/BV1xx");
  });

  it("drops the hash", () => {
    expect(normalizeUrlForDedup("https://example.com/a#section")).toBe(
      "https://example.com/a",
    );
  });

  it("sorts query params so order does not matter", () => {
    expect(normalizeUrlForDedup("https://example.com/a?b=2&a=1")).toBe(
      normalizeUrlForDedup("https://example.com/a?a=1&b=2"),
    );
  });

  it("lowercases the hostname but keeps the path case", () => {
    expect(normalizeUrlForDedup("https://Example.COM/Path")).toBe(
      "https://example.com/Path",
    );
  });

  it("removes a trailing slash but keeps the root path", () => {
    expect(normalizeUrlForDedup("https://example.com/a/")).toBe(
      "https://example.com/a",
    );
    expect(normalizeUrlForDedup("https://example.com/")).toBe(
      "https://example.com/",
    );
  });

  it("keeps the original string when it is not a url", () => {
    expect(normalizeUrlForDedup("not a url")).toBe("not a url");
  });

  it("keeps meaningful params", () => {
    expect(normalizeUrlForDedup("https://example.com/search?q=hello")).toBe(
      "https://example.com/search?q=hello",
    );
  });
});

describe("isSameUrlForDedup", () => {
  it("treats the same article with different tracking as duplicates", () => {
    expect(
      isSameUrlForDedup(
        "https://mp.weixin.qq.com/s/abc?scene=1&from=timeline",
        "https://mp.weixin.qq.com/s/abc",
      ),
    ).toBe(true);
  });

  it("treats different ids as different", () => {
    expect(
      isSameUrlForDedup(
        "https://example.com/post/1",
        "https://example.com/post/2",
      ),
    ).toBe(false);
  });
});
