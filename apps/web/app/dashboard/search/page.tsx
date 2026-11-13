"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import BookmarksGrid from "@/components/dashboard/bookmarks/BookmarksGrid";
import BookmarksGridSkeleton from "@/components/dashboard/bookmarks/BookmarksGridSkeleton";
import { SearchShortcuts } from "@/components/dashboard/search/SearchShortcuts";
import { useBookmarkSearch } from "@/lib/hooks/bookmark-search";
import {
  loadRecentSearches,
  recordRecentSearch,
  saveRecentSearches,
} from "@/lib/recent-searches";
import { useInSearchPageStore } from "@/lib/store/useInSearchPageStore";
import { useSortOrderStore } from "@/lib/store/useSortOrderStore";

function SearchComp() {
  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useBookmarkSearch();

  const { setInSearchPage } = useInSearchPageStore();

  const { setSortOrder } = useSortOrderStore();

  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    setRecent(loadRecentSearches(window.localStorage));
  }, []);

  useEffect(() => {
    if (!q.trim()) return;
    setRecent(recordRecentSearch(window.localStorage, q));
  }, [q]);

  useEffect(() => {
    // also see related cleanup code in SortOrderToggle.tsx
    setSortOrder("relevance");
  }, [setSortOrder]);

  useEffect(() => {
    setInSearchPage(true);
    return () => setInSearchPage(false);
  }, [setInSearchPage]);

  if (error) {
    throw error;
  }

  const clearRecent = () => {
    saveRecentSearches(window.localStorage, []);
    setRecent([]);
  };

  return (
    <div className="flex flex-col gap-3">
      {!q.trim() && (
        <SearchShortcuts recent={recent} onClearRecent={clearRecent} />
      )}
      {data ? (
        <BookmarksGrid
          hasNextPage={hasNextPage}
          fetchNextPage={fetchNextPage}
          isFetchingNextPage={isFetchingNextPage}
          bookmarks={data.pages.flatMap((b) => b.bookmarks)}
        />
      ) : (
        <BookmarksGridSkeleton />
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchComp />
    </Suspense>
  );
}
