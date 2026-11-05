-- CreateTable
CREATE TABLE `student_import_batches` (
    `id` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `fileName` VARCHAR(255) NOT NULL,
    `fileSize` INTEGER NOT NULL,
    `fileSha256` CHAR(64) NOT NULL,
    `mappingKey` CHAR(64) NOT NULL,
    `mapping` JSON NOT NULL,
    `status` ENUM('PREVIEW_READY', 'COMPLETED', 'FAILED') NOT NULL DEFAULT 'PREVIEW_READY',
    `revision` INTEGER NOT NULL DEFAULT 0,
    `totalRows` INTEGER NOT NULL DEFAULT 0,
    `validRows` INTEGER NOT NULL DEFAULT 0,
    `invalidRows` INTEGER NOT NULL DEFAULT 0,
    `possibleDuplicateRows` INTEGER NOT NULL DEFAULT 0,
    `createdStudents` INTEGER NOT NULL DEFAULT 0,
    `excludedRows` INTEGER NOT NULL DEFAULT 0,
    `confirmationRequestId` VARCHAR(64) NULL,
    `confirmationFingerprint` CHAR(64) NULL,
    `failureCode` VARCHAR(80) NULL,
    `failureMessage` VARCHAR(500) NULL,
    `completedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `student_import_batches_confirmationRequestId_key`(`confirmationRequestId`),
    INDEX `student_import_batches_createdAt_idx`(`createdAt`),
    INDEX `student_import_batches_actorId_createdAt_idx`(`actorId`, `createdAt`),
    INDEX `student_import_batches_fileSha256_classId_mappingKey_idx`(`fileSha256`, `classId`, `mappingKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_import_rows` (
    `id` VARCHAR(30) NOT NULL,
    `batchId` VARCHAR(30) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `saintName` VARCHAR(120) NULL,
    `fullName` VARCHAR(180) NULL,
    `status` ENUM('VALID', 'INVALID', 'POSSIBLE_DUPLICATE') NOT NULL,
    `validationErrors` JSON NULL,
    `candidateStudentIds` JSON NULL,
    `candidateRowNumbers` JSON NULL,
    `resolution` ENUM('CREATE_SEPARATE', 'EXCLUDE') NULL,
    `createdStudentId` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `student_import_rows_batchId_status_idx`(`batchId`, `status`),
    UNIQUE INDEX `student_import_rows_batchId_rowNumber_key`(`batchId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `student_import_events` (
    `id` VARCHAR(30) NOT NULL,
    `batchId` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `type` ENUM('PREVIEW_CREATED', 'CONFIRMED', 'FAILED') NOT NULL,
    `details` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `student_import_events_batchId_createdAt_idx`(`batchId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `student_import_batches` ADD CONSTRAINT `student_import_batches_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_import_batches` ADD CONSTRAINT `student_import_batches_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_import_rows` ADD CONSTRAINT `student_import_rows_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `student_import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `student_import_rows` ADD CONSTRAINT `student_import_rows_createdStudentId_fkey` FOREIGN KEY (`createdStudentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_import_events` ADD CONSTRAINT `student_import_events_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `student_import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `student_import_events` ADD CONSTRAINT `student_import_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

