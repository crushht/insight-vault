CREATE TABLE `contentReports` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`markdown` text NOT NULL,
	`sourceCount` integer DEFAULT 0 NOT NULL,
	`mode` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `contentReports_userId_idx` ON `contentReports` (`userId`,`createdAt`);