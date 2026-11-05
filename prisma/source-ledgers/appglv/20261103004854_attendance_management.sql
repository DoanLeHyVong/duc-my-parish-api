-- CreateTable
CREATE TABLE `schedule_templates` (
    `id` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `createdById` VARCHAR(30) NOT NULL,
    `activityType` ENUM('TUESDAY_MASS', 'THURSDAY_MASS', 'SUNDAY_MASS', 'CATECHISM_LESSON') NOT NULL,
    `weekday` INTEGER NOT NULL,
    `occurrenceMinute` INTEGER NOT NULL,
    `utcOffsetMinutes` INTEGER NOT NULL,
    `windowOpenOffsetMinutes` INTEGER NOT NULL,
    `windowCloseOffsetMinutes` INTEGER NOT NULL,
    `effectiveStart` DATE NOT NULL,
    `effectiveEnd` DATE NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `schedule_templates_classId_isActive_idx`(`classId`, `isActive`),
    UNIQUE INDEX `schedule_templates_classId_activityType_weekday_occurrenceMi_key`(`classId`, `activityType`, `weekday`, `occurrenceMinute`, `effectiveStart`, `effectiveEnd`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `scheduleTemplateId` VARCHAR(30) NULL,
    `activityType` ENUM('TUESDAY_MASS', 'THURSDAY_MASS', 'SUNDAY_MASS', 'CATECHISM_LESSON') NOT NULL,
    `occursAt` DATETIME(3) NOT NULL,
    `windowOpensAt` DATETIME(3) NOT NULL,
    `windowClosesAt` DATETIME(3) NOT NULL,
    `status` ENUM('OPEN', 'SUBMITTED', 'FINALIZED') NOT NULL DEFAULT 'OPEN',
    `isCancelled` BOOLEAN NOT NULL DEFAULT false,
    `hasUserMutation` BOOLEAN NOT NULL DEFAULT false,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `submittedAt` DATETIME(3) NULL,
    `submittedById` VARCHAR(30) NULL,
    `finalizedAt` DATETIME(3) NULL,
    `finalizedById` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_sessions_classId_status_occursAt_idx`(`classId`, `status`, `occursAt`),
    INDEX `attendance_sessions_scheduleTemplateId_occursAt_idx`(`scheduleTemplateId`, `occursAt`),
    UNIQUE INDEX `attendance_sessions_classId_activityType_occursAt_key`(`classId`, `activityType`, `occursAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_records` (
    `id` VARCHAR(30) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `studentId` VARCHAR(30) NOT NULL,
    `saintNameSnapshot` VARCHAR(120) NOT NULL,
    `fullNameSnapshot` VARCHAR(180) NOT NULL,
    `state` ENUM('NOT_MARKED', 'PRESENT', 'ABSENT') NOT NULL DEFAULT 'NOT_MARKED',
    `updatedById` VARCHAR(30) NULL,
    `markedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `attendance_records_sessionId_state_idx`(`sessionId`, `state`),
    INDEX `attendance_records_studentId_createdAt_idx`(`studentId`, `createdAt`),
    UNIQUE INDEX `attendance_records_sessionId_studentId_key`(`sessionId`, `studentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_events` (
    `id` VARCHAR(30) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NULL,
    `type` ENUM('GENERATED', 'SCHEDULE_CHANGED', 'SAVED', 'SUBMITTED', 'FINALIZED', 'CORRECTED') NOT NULL,
    `requestId` VARCHAR(64) NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendance_events_requestId_key`(`requestId`),
    INDEX `attendance_events_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `attendance_audit_entries` (
    `id` VARCHAR(30) NOT NULL,
    `sessionId` VARCHAR(30) NOT NULL,
    `recordId` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `beforeState` ENUM('NOT_MARKED', 'PRESENT', 'ABSENT') NOT NULL,
    `afterState` ENUM('NOT_MARKED', 'PRESENT', 'ABSENT') NOT NULL,
    `reason` VARCHAR(500) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `attendance_audit_entries_requestId_key`(`requestId`),
    INDEX `attendance_audit_entries_sessionId_createdAt_idx`(`sessionId`, `createdAt`),
    INDEX `attendance_audit_entries_recordId_createdAt_idx`(`recordId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `schedule_exceptions` (
    `id` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `scheduleTemplateId` VARCHAR(30) NULL,
    `targetSessionId` VARCHAR(30) NULL,
    `resultSessionId` VARCHAR(30) NULL,
    `createdById` VARCHAR(30) NOT NULL,
    `type` ENUM('CANCEL', 'MOVE', 'ADD') NOT NULL,
    `note` VARCHAR(500) NULL,
    `previousOccursAt` DATETIME(3) NULL,
    `newOccursAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `schedule_exceptions_classId_createdAt_idx`(`classId`, `createdAt`),
    INDEX `schedule_exceptions_scheduleTemplateId_createdAt_idx`(`scheduleTemplateId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `schedule_templates` ADD CONSTRAINT `schedule_templates_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_templates` ADD CONSTRAINT `schedule_templates_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_scheduleTemplateId_fkey` FOREIGN KEY (`scheduleTemplateId`) REFERENCES `schedule_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_submittedById_fkey` FOREIGN KEY (`submittedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_sessions` ADD CONSTRAINT `attendance_sessions_finalizedById_fkey` FOREIGN KEY (`finalizedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `attendance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_records` ADD CONSTRAINT `attendance_records_updatedById_fkey` FOREIGN KEY (`updatedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `attendance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_events` ADD CONSTRAINT `attendance_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_audit_entries` ADD CONSTRAINT `attendance_audit_entries_sessionId_fkey` FOREIGN KEY (`sessionId`) REFERENCES `attendance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_audit_entries` ADD CONSTRAINT `attendance_audit_entries_recordId_fkey` FOREIGN KEY (`recordId`) REFERENCES `attendance_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `attendance_audit_entries` ADD CONSTRAINT `attendance_audit_entries_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_scheduleTemplateId_fkey` FOREIGN KEY (`scheduleTemplateId`) REFERENCES `schedule_templates`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_targetSessionId_fkey` FOREIGN KEY (`targetSessionId`) REFERENCES `attendance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_resultSessionId_fkey` FOREIGN KEY (`resultSessionId`) REFERENCES `attendance_sessions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `schedule_exceptions` ADD CONSTRAINT `schedule_exceptions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

