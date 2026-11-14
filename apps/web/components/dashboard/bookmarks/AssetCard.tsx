"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

import type { ZBookmarkTypeAsset } from "@karakeep/shared/types/bookmarks";
import { getAssetUrl } from "@karakeep/shared/utils/assetUtils";
import { getSourceUrl } from "@karakeep/shared/utils/bookmarkUtils";

import { BookmarkLayoutAdaptingCard } from "./BookmarkLayoutAdaptingCard";
import FooterLinkURL from "./FooterLinkURL";

function formatSize(size?: number | null) {
  if (!size || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/** 没有可用缩略图时的占位：图标 + 文件名，避免出现「破图」 */
function AssetPlaceholder({
  bookmark,
  className,
}: {
  bookmark: ZBookmarkTypeAsset;
  className?: string;
}) {
  const { fileName, assetType } = bookmark.content;
  const size = formatSize(bookmark.content.size);
  return (
    <div
      className={cn(
        className,
        "flex flex-col items-center justify-center gap-2 bg-surface-sunken text-muted-foreground",
      )}
    >
      <FileText size={56} strokeWidth={1.2} />
      <div className="max-w-full truncate px-3 text-caption">
        {assetType === "pdf" ? "PDF" : "图片"}
        {size ? ` · ${size}` : ""}
      </div>
      {fileName ? (
        <div className="max-w-full truncate px-3 text-caption opacity-70">
          {fileName}
        </div>
      ) : null}
    </div>
  );
}

function AssetImage({
  bookmark,
  className,
}: {
  bookmark: ZBookmarkTypeAsset;
  className?: string;
}) {
  const bookmarkedAsset = bookmark.content;
  const [broken, setBroken] = useState(false);

  if (bookmarkedAsset.assetType === "image") {
    return (
      <Link href={`/dashboard/preview/${bookmark.id}`}>
        <Image
          alt={bookmarkedAsset.fileName ?? "图片"}
          src={getAssetUrl(bookmarkedAsset.assetId)}
          fill={true}
          unoptimized
          className={className}
          onError={() => setBroken(true)}
        />
        {broken ? (
          <AssetPlaceholder bookmark={bookmark} className="absolute inset-0" />
        ) : null}
      </Link>
    );
  }

  if (bookmarkedAsset.assetType === "pdf") {
    const screenshotAssetId = bookmark.assets.find(
      (r) => r.assetType === "assetScreenshot",
    )?.id;
    if (!screenshotAssetId || broken) {
      return <AssetPlaceholder bookmark={bookmark} className={className} />;
    }
    return (
      <Link href={`/dashboard/preview/${bookmark.id}`}>
        <Image
          alt={bookmarkedAsset.fileName ?? "PDF"}
          src={getAssetUrl(screenshotAssetId)}
          fill={true}
          unoptimized
          className={className}
          onError={() => setBroken(true)}
        />
      </Link>
    );
  }

  return <span />;
}

export default function AssetCard({
  bookmark: bookmarkedAsset,
  className,
  bookmarkIndex,
}: {
  bookmark: ZBookmarkTypeAsset;
  className?: string;
  bookmarkIndex?: number;
}) {
  const sourceUrl = getSourceUrl(bookmarkedAsset);
  const size = formatSize(bookmarkedAsset.content.size);
  const meta = [
    bookmarkedAsset.content.assetType === "pdf" ? "PDF" : "图片",
    size,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <BookmarkLayoutAdaptingCard
      title={
        bookmarkedAsset.title ??
        bookmarkedAsset.content.fileName ??
        (bookmarkedAsset.content.assetType === "pdf" ? "PDF 文档" : "图片")
      }
      footer={
        sourceUrl ? (
          <FooterLinkURL url={sourceUrl} />
        ) : (
          <span className="text-caption text-muted-foreground">{meta}</span>
        )
      }
      bookmark={bookmarkedAsset}
      className={className}
      bookmarkIndex={bookmarkIndex}
      wrapTags={true}
      image={(_layout, className) => (
        <div className="relative size-full flex-1">
          <AssetImage bookmark={bookmarkedAsset} className={className} />
        </div>
      )}
    />
  );
}
