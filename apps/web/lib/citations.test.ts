import { describe, expect, it } from "vitest";

import { splitCitations } from "./citations";

const C = [
  { n: 1, bookmarkId: "b1" },
  { n: 2, bookmarkId: "b2" },
];

describe("splitCitations", () => {
  it("returns a single text segment when there is no citation", () => {
    expect(splitCitations("没有引用的一段话", C)).toEqual([
      { text: "没有引用的一段话" },
    ]);
  });

  it("splits text around one citation", () => {
    const out = splitCitations("结论 [1] 结束", C);
    expect(out).toEqual([
      { text: "结论 " },
      { text: "", n: 1, bookmarkId: "b1" },
      { text: " 结束" },
    ]);
  });

  it("handles several citations", () => {
    const out = splitCitations("[1] 和 [2]", C);
    const refs = out.filter((s) => s.n !== undefined);
    expect(refs.map((r) => r.n)).toEqual([1, 2]);
    expect(refs.map((r) => r.bookmarkId)).toEqual(["b1", "b2"]);
  });

  it("keeps unknown numbers as plain text", () => {
    const out = splitCitations("越界 [9]", C);
    expect(out).toEqual([{ text: "越界 " }, { text: "[9]" }]);
  });

  it("reconstructs the original text when segments are concatenated", () => {
    const content = "A [1] B [2] C";
    const out = splitCitations(content, C);
    const rebuilt = out.map((s) => (s.n !== undefined ? `[${s.n}]` : s.text)).join("");
    expect(rebuilt).toBe(content);
  });

  it("does not treat non-numeric brackets as citations", () => {
    expect(splitCitations("说明 [abc]", C)).toEqual([{ text: "说明 [abc]" }]);
  });

  it("handles an empty citation list", () => {
    expect(splitCitations("结果 [1]", [])).toEqual([
      { text: "结果 " },
      { text: "[1]" },
    ]);
  });

  it("handles a citation at the very start", () => {
    const out = splitCitations("[1]开头就有", C);
    expect(out[0]).toEqual({ text: "", n: 1, bookmarkId: "b1" });
    expect(out[1]).toEqual({ text: "开头就有" });
  });
});
