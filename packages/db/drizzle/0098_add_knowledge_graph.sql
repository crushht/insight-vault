CREATE TABLE `entities` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`normalizedName` text NOT NULL,
	`description` text,
	`mentionCount` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `entities_userId_idx` ON `entities` (`userId`);--> statement-breakpoint
CREATE INDEX `entities_userId_kind_idx` ON `entities` (`userId`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `entities_userId_kind_normalizedName_unique` ON `entities` (`userId`,`kind`,`normalizedName`);--> statement-breakpoint
CREATE TABLE `entityMentions` (
	`id` text PRIMARY KEY NOT NULL,
	`entityId` text NOT NULL,
	`bookmarkId` text NOT NULL,
	`userId` text NOT NULL,
	`chunkId` text,
	`quote` text,
	`confidence` real DEFAULT 0.8 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chunkId`) REFERENCES `bookmarkChunks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entityMentions_entityId_idx` ON `entityMentions` (`entityId`);--> statement-breakpoint
CREATE INDEX `entityMentions_bookmarkId_idx` ON `entityMentions` (`bookmarkId`);--> statement-breakpoint
CREATE INDEX `entityMentions_userId_idx` ON `entityMentions` (`userId`);--> statement-breakpoint
CREATE TABLE `entityRelations` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`fromEntityId` text NOT NULL,
	`toEntityId` text NOT NULL,
	`relation` text NOT NULL,
	`weight` real DEFAULT 1 NOT NULL,
	`evidenceBookmarkId` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fromEntityId`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`toEntityId`) REFERENCES `entities`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidenceBookmarkId`) REFERENCES `bookmarks`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `entityRelations_userId_idx` ON `entityRelations` (`userId`);--> statement-breakpoint
CREATE INDEX `entityRelations_from_idx` ON `entityRelations` (`fromEntityId`);--> statement-breakpoint
CREATE UNIQUE INDEX `entityRelations_unique` ON `entityRelations` (`userId`,`fromEntityId`,`toEntityId`,`relation`);