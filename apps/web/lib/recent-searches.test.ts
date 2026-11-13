import { describe, expect, it } from "vitest";

import type { StorageLike } from "./recent-searches";
import {
  MAX_RECENT_SEARCHES,
  loadRecentSearches,
  parseRecentSearches,
  pushRecentSearch,
  recordRecentSearch,
} from "./recent-searches";

function memoryStorage(initial: Record<string, string> = {}): StorageLike {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("recent searches", () => {
  it("parses only strings and trims them", () => {
    expect(parseRecentSearches('["a"," b ",3,null]')).toEqual(["a", "b"]);
    expect(parseRecentSearches("not json")).toEqual([]);
    expect(parseRecentSearches(null)).toEqual([]);
  });

  it("moves a repeated query to the front instead of duplicating", () => {
    expect(pushRecentSearch(["b", "a"], "a")).toEqual(["a", "b"]);
  });

  it("caps the list", () => {
    let list: string[] = [];
    for (let i = 0; i < MAX_RECENT_SEARCHES + 4; i++) {
      list = pushRecentSearch(list, `q${i}`);
    }
    expect(list).toHaveLength(MAX_RECENT_SEARCHES);
    expect(list[0]).toBe(`q${MAX_RECENT_SEARCHES + 3}`);
  });

  it("ignores blank queries", () => {
    expect(pushRecentSearch(["a"], "   ")).toEqual(["a"]);
  });

  it("round-trips through storage", () => {
    const storage = memoryStorage();
    expect(loadRecentSearches(storage)).toEqual([]);
    recordRecentSearch(storage, "is:image");
    expect(loadRecentSearches(storage)).toEqual(["is:image"]);
    recordRecentSearch(storage, "react");
    expect(loadRecentSearches(storage)).toEqual(["react", "is:image"]);
  });

  it("survives a broken storage", () => {
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("boom");
      },
      setItem: () => {
        throw new Error("boom");
      },
    };
    expect(loadRecentSearches(broken)).toEqual([]);
    expect(() => recordRecentSearch(broken, "x")).not.toThrow();
  });
});
