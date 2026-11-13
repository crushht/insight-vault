CREATE TABLE `userEntitlements` (
	`userId` text PRIMARY KEY NOT NULL,
	`tier` text DEFAULT 'free' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`periodStart` integer,
	`periodEnd` integer,
	`aiTokensLimit` integer DEFAULT 200000 NOT NULL,
	`aiCallsLimit` integer DEFAULT 200 NOT NULL,
	`storageLimit` integer DEFAULT 1073741824 NOT NULL,
	`modifiedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `userEntitlements_tier_idx` ON `userEntitlements` (`tier`);