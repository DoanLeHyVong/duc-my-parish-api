ALTER TABLE `users` ADD COLUMN `deletedAt` DATETIME(3) NULL;

CREATE TABLE `account_deletion_requests` (
  `id` VARCHAR(30) NOT NULL,
  `requestKey` VARCHAR(64) NOT NULL,
  `requesterId` VARCHAR(30) NOT NULL,
  `activeRequesterId` VARCHAR(30) NULL,
  `status` ENUM('SUBMITTED','IN_REVIEW','VERIFIED','APPROVED','REJECTED','EXECUTED') NOT NULL DEFAULT 'SUBMITTED',
  `revision` INTEGER NOT NULL DEFAULT 1,
  `decisionReason` TEXT NULL,
  `retentionDecisions` JSON NULL,
  `removedData` JSON NULL,
  `submittedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `inReviewAt` DATETIME(3) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `approvedAt` DATETIME(3) NULL,
  `rejectedAt` DATETIME(3) NULL,
  `executedAt` DATETIME(3) NULL,
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `account_deletion_requests_requestKey_key` (`requestKey`),
  UNIQUE INDEX `account_deletion_requests_activeRequesterId_key` (`activeRequesterId`),
  INDEX `account_deletion_requests_status_submittedAt_idx` (`status`, `submittedAt`),
  INDEX `account_deletion_requests_requesterId_submittedAt_idx` (`requesterId`, `submittedAt`),
  CONSTRAINT `account_deletion_requests_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `account_deletion_events` (
  `id` VARCHAR(30) NOT NULL,
  `requestId` VARCHAR(30) NOT NULL,
  `actorId` VARCHAR(30) NOT NULL,
  `type` ENUM('SUBMITTED','REVIEW_STARTED','VERIFIED','APPROVED','REJECTED','EXECUTED') NOT NULL,
  `fromStatus` ENUM('SUBMITTED','IN_REVIEW','VERIFIED','APPROVED','REJECTED','EXECUTED') NULL,
  `toStatus` ENUM('SUBMITTED','IN_REVIEW','VERIFIED','APPROVED','REJECTED','EXECUTED') NOT NULL,
  `reason` TEXT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `account_deletion_events_requestId_createdAt_idx` (`requestId`, `createdAt`),
  INDEX `account_deletion_events_actorId_createdAt_idx` (`actorId`, `createdAt`),
  CONSTRAINT `account_deletion_events_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `account_deletion_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `account_deletion_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

