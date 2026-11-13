CREATE TABLE `orders` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`provider` text NOT NULL,
	`providerRef` text NOT NULL,
	`status` text DEFAULT 'created' NOT NULL,
	`plan` text NOT NULL,
	`amountMinor` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`paidAt` integer,
	`refundedAt` integer,
	`rawPayload` text,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `orders_userId_idx` ON `orders` (`userId`);--> statement-breakpoint
CREATE INDEX `orders_userId_createdAt_idx` ON `orders` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_provider_ref_unique` ON `orders` (`provider`,`providerRef`);--> statement-breakpoint
CREATE TABLE `webhookEvents` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`externalId` text NOT NULL,
	`type` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`createdAt` integer NOT NULL,
	`processedAt` integer
);
--> statement-breakpoint
CREATE INDEX `webhookEvents_status_idx` ON `webhookEvents` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `webhookEvents_provider_externalId_unique` ON `webhookEvents` (`provider`,`externalId`);