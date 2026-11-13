"use client";

import { useTranslation } from "@/lib/i18n/client";
import { AlertCircle } from "lucide-react";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import { BookmarkLayoutAdaptingCard } from "./BookmarkLayoutAdaptingCard";

export default function UnknownCard({
  bookmark,
  className,
  bookmarkIndex,
}: {
  bookmark: ZBookmark;
  className?: string;
  bookmarkIndex?: number;
}) {
  const { t } = useTranslation();
  return (
    <BookmarkLayoutAdaptingCard
      title={bookmark.title}
      bookmark={bookmark}
      className={className}
      bookmarkIndex={bookmarkIndex}
      wrapTags={false}
      image={(_layout) => (
        <div className="flex size-full flex-1 flex-col items-center justify-center bg-destructive/10 dark:bg-destructive/10/10">
          <AlertCircle className="mb-3 h-10 w-10 text-destructive" />
          <h3 className="font-medium text-destructive dark:text-destructive">
            {t("common.something_went_wrong")}
          </h3>
        </div>
      )}
    />
  );
}
