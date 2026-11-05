CREATE TABLE `grade_columns` (
  `id` VARCHAR(30) NOT NULL, `classId` VARCHAR(30) NOT NULL, `semesterId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(120) NOT NULL, `minimum` DECIMAL(18,6) NOT NULL, `maximum` DECIMAL(18,6) NOT NULL,
  `precision` INTEGER NOT NULL, `revision` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `grade_columns_classId_semesterId_name_key` (`classId`,`semesterId`,`name`),
  UNIQUE INDEX `grade_columns_id_classId_semesterId_key` (`id`,`classId`,`semesterId`), INDEX `grade_columns_classId_semesterId_idx` (`classId`,`semesterId`),
  CONSTRAINT `grade_columns_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `grade_columns_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `grade_records` (
  `id` VARCHAR(30) NOT NULL, `studentId` VARCHAR(30) NOT NULL, `classId` VARCHAR(30) NOT NULL, `semesterId` VARCHAR(30) NOT NULL,
  `gradeColumnId` VARCHAR(30) NOT NULL, `value` DECIMAL(18,6) NOT NULL, `revision` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `grade_records_studentId_classId_semesterId_gradeColumnId_key` (`studentId`,`classId`,`semesterId`,`gradeColumnId`),
  INDEX `grade_records_classId_semesterId_studentId_idx` (`classId`,`semesterId`,`studentId`),
  CONSTRAINT `grade_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `grade_records_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `grade_records_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `grade_records_gradeColumnId_classId_semesterId_fkey` FOREIGN KEY (`gradeColumnId`,`classId`,`semesterId`) REFERENCES `grade_columns`(`id`,`classId`,`semesterId`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `grade_audit_entries` (
  `id` VARCHAR(30) NOT NULL, `gradeRecordId` VARCHAR(30) NOT NULL, `actorId` VARCHAR(30) NOT NULL,
  `requestId` VARCHAR(64) NOT NULL, `fingerprint` CHAR(64) NOT NULL, `beforeValue` DECIMAL(18,6) NULL,
  `afterValue` DECIMAL(18,6) NOT NULL, `beforeRevision` INTEGER NULL, `afterRevision` INTEGER NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), UNIQUE INDEX `grade_audit_entries_requestId_key` (`requestId`),
  INDEX `grade_audit_entries_gradeRecordId_createdAt_idx` (`gradeRecordId`,`createdAt`), INDEX `grade_audit_entries_actorId_createdAt_idx` (`actorId`,`createdAt`),
  CONSTRAINT `grade_audit_entries_gradeRecordId_fkey` FOREIGN KEY (`gradeRecordId`) REFERENCES `grade_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `grade_audit_entries_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `classification_rule_versions` (
  `id` VARCHAR(30) NOT NULL, `classId` VARCHAR(30) NOT NULL, `semesterId` VARCHAR(30) NOT NULL, `version` INTEGER NOT NULL,
  `status` ENUM('DRAFT','PUBLISHED') NOT NULL DEFAULT 'DRAFT', `decimalPlaces` INTEGER NOT NULL,
  `roundingMethod` ENUM('HALF_UP','HALF_EVEN','DOWN','UP') NOT NULL, `revision` INTEGER NOT NULL DEFAULT 0,
  `publishedAt` DATETIME(3) NULL, `publishedById` VARCHAR(30) NULL, `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`), UNIQUE INDEX `rule_versions_scope_version_key` (`classId`,`semesterId`,`version`),
  INDEX `rule_versions_scope_status_idx` (`classId`,`semesterId`,`status`,`version`),
  CONSTRAINT `rule_versions_class_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rule_versions_semester_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rule_versions_publisher_fkey` FOREIGN KEY (`publishedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `classification_rule_weights` (
  `id` VARCHAR(30) NOT NULL, `ruleVersionId` VARCHAR(30) NOT NULL, `gradeColumnId` VARCHAR(30) NOT NULL, `weight` DECIMAL(18,6) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `rule_weights_version_column_key` (`ruleVersionId`,`gradeColumnId`),
  CONSTRAINT `rule_weights_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `rule_weights_column_fkey` FOREIGN KEY (`gradeColumnId`) REFERENCES `grade_columns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `classification_rule_bands` (
  `id` VARCHAR(30) NOT NULL, `ruleVersionId` VARCHAR(30) NOT NULL, `minimumInclusive` DECIMAL(18,6) NOT NULL, `label` VARCHAR(120) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE INDEX `rule_bands_version_minimum_key` (`ruleVersionId`,`minimumInclusive`),
  INDEX `rule_bands_version_minimum_idx` (`ruleVersionId`,`minimumInclusive`),
  CONSTRAINT `rule_bands_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `classification_results` (
  `id` VARCHAR(30) NOT NULL, `studentId` VARCHAR(30) NOT NULL, `classId` VARCHAR(30) NOT NULL, `semesterId` VARCHAR(30) NOT NULL,
  `ruleVersionId` VARCHAR(30) NOT NULL, `resultRevision` INTEGER NOT NULL, `weightedAverage` DECIMAL(18,6) NOT NULL,
  `roundedAverage` DECIMAL(18,6) NOT NULL, `classificationLabel` VARCHAR(120) NOT NULL, `inputSnapshot` JSON NOT NULL,
  `inputFingerprint` CHAR(64) NOT NULL, `requestId` VARCHAR(64) NOT NULL, `actorId` VARCHAR(30) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), PRIMARY KEY (`id`), UNIQUE INDEX `classification_results_requestId_key` (`requestId`),
  UNIQUE INDEX `results_scope_revision_key` (`studentId`,`classId`,`semesterId`,`resultRevision`),
  INDEX `results_class_semester_created_idx` (`classId`,`semesterId`,`createdAt`),
  INDEX `results_student_semester_created_idx` (`studentId`,`semesterId`,`createdAt`), INDEX `results_rule_version_idx` (`ruleVersionId`),
  CONSTRAINT `results_student_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `results_class_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `results_semester_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `results_rule_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `results_actor_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

