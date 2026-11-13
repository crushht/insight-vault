CREATE TABLE `bookmarkChunks` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmarkId` text NOT NULL,
	`userId` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`tokenCount` integer DEFAULT 0 NOT NULL,
	`startOffset` integer,
	`endOffset` integer,
	`embeddingStatus` text DEFAULT 'pending' NOT NULL,
	`embeddingModel` text,
	`embeddingDims` integer,
	`contentHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `bookmarkChunks_userId_idx` ON `bookmarkChunks` (`userId`);--> statement-breakpoint
CREATE INDEX `bookmarkChunks_embeddingStatus_idx` ON `bookmarkChunks` (`embeddingStatus`);--> statement-breakpoint
CREATE UNIQUE INDEX `bookmarkChunks_bookmarkId_ordinal_unique` ON `bookmarkChunks` (`bookmarkId`,`ordinal`);