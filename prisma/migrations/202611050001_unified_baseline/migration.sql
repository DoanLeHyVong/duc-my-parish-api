-- CreateTable
CREATE TABLE `Post` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `excerpt` TEXT NOT NULL,
    `content` LONGTEXT NOT NULL,
    `featuredImageId` INTEGER NULL,
    `authorId` VARCHAR(30) NOT NULL,
    `status` ENUM('DRAFT', 'SCHEDULED', 'PUBLISHED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `sourceName` VARCHAR(191) NULL,
    `sourceUrl` VARCHAR(191) NULL,
    `seoTitle` VARCHAR(191) NULL,
    `seoDescription` TEXT NULL,
    `scheduledAt` DATETIME(3) NULL,
    `publishedAt` DATETIME(3) NULL,
    `viewCount` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Post_slug_key`(`slug`),
    INDEX `Post_status_publishedAt_idx`(`status`, `publishedAt`),
    INDEX `Post_deletedAt_idx`(`deletedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Category` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `parentId` INTEGER NULL,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `imageId` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Category_slug_key`(`slug`),
    INDEX `Category_parentId_sortOrder_idx`(`parentId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostCategory` (
    `postId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,

    PRIMARY KEY (`postId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Tag_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostTag` (
    `postId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,

    PRIMARY KEY (`postId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Media` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cloudinaryPublicId` VARCHAR(191) NOT NULL,
    `originalName` VARCHAR(191) NOT NULL,
    `secureUrl` VARCHAR(191) NOT NULL,
    `thumbnailUrl` VARCHAR(191) NULL,
    `resourceType` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL,
    `width` INTEGER NULL,
    `height` INTEGER NULL,
    `bytes` INTEGER NOT NULL,
    `altText` VARCHAR(191) NULL,
    `caption` VARCHAR(191) NULL,
    `folder` VARCHAR(191) NOT NULL,
    `uploadedById` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `deletedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Media_cloudinaryPublicId_key`(`cloudinaryPublicId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PostMedia` (
    `postId` INTEGER NOT NULL,
    `mediaId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`postId`, `mediaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Menu` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Menu_location_key`(`location`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MenuItem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `menuId` INTEGER NOT NULL,
    `parentId` INTEGER NULL,
    `label` VARCHAR(191) NOT NULL,
    `linkType` ENUM('INTERNAL', 'EXTERNAL', 'SECTION', 'CATEGORY', 'POST') NOT NULL,
    `referenceId` INTEGER NULL,
    `url` VARCHAR(191) NULL,
    `target` VARCHAR(191) NOT NULL DEFAULT '_self',
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `MenuItem_menuId_parentId_sortOrder_idx`(`menuId`, `parentId`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Banner` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `subtitle` VARCHAR(191) NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `primaryText` VARCHAR(191) NULL,
    `primaryUrl` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `HomeSection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `sectionKey` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `componentType` VARCHAR(191) NOT NULL,
    `categoryId` INTEGER NULL,
    `displayLimit` INTEGER NOT NULL DEFAULT 6,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `settings` JSON NOT NULL,
    `isVisible` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `HomeSection_sectionKey_key`(`sectionKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Announcement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endsAt` DATETIME(3) NULL,
    `isPinned` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Announcement_isActive_startsAt_endsAt_idx`(`isActive`, `startsAt`, `endsAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MassSchedule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `dayOfWeek` INTEGER NOT NULL,
    `startTime` VARCHAR(191) NOT NULL,
    `massType` VARCHAR(191) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `validFrom` DATETIME(3) NULL,
    `validTo` DATETIME(3) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,

    INDEX `MassSchedule_dayOfWeek_sortOrder_idx`(`dayOfWeek`, `sortOrder`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SpecialMass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `location` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NULL,
    `location` VARCHAR(191) NOT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `isFeatured` BOOLEAN NOT NULL DEFAULT false,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Event_slug_key`(`slug`),
    INDEX `Event_startsAt_isActive_idx`(`startsAt`, `isActive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Album` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `coverUrl` VARCHAR(191) NULL,
    `eventDate` DATETIME(3) NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Album_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AlbumMedia` (
    `albumId` INTEGER NOT NULL,
    `mediaId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`albumId`, `mediaId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ParishProfile` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `diocese` VARCHAR(191) NOT NULL,
    `patronSaint` VARCHAR(191) NULL,
    `description` LONGTEXT NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `mapEmbedUrl` TEXT NULL,
    `logoUrl` VARCHAR(191) NULL,
    `heroUrl` VARCHAR(191) NULL,
    `facebookUrl` VARCHAR(191) NULL,
    `youtubeUrl` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Clergy` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `fullName` VARCHAR(191) NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `bio` TEXT NULL,
    `imageUrl` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Organization` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `leader` VARCHAR(191) NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `key` VARCHAR(191) NOT NULL,
    `value` JSON NOT NULL,
    `group` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Setting_key_key`(`key`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `actorId` VARCHAR(30) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NULL,
    `entityId` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `ipAddress` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `access_roles` (
    `id` VARCHAR(30) NOT NULL,
    `code` ENUM('SUPER_ADMIN', 'PARISH_ADMIN', 'APPGLV_ADMIN', 'TEACHER') NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `access_roles_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `permissions` (
    `id` VARCHAR(30) NOT NULL,
    `code` VARCHAR(100) NOT NULL,
    `description` VARCHAR(255) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `permissions_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `user_role_assignments` (
    `userId` VARCHAR(30) NOT NULL,
    `roleId` VARCHAR(30) NOT NULL,
    `assignedBy` VARCHAR(30) NULL,
    `assignedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `user_role_assignments_roleId_userId_idx`(`roleId`, `userId`),
    PRIMARY KEY (`userId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `role_permissions` (
    `roleId` VARCHAR(30) NOT NULL,
    `permissionId` VARCHAR(30) NOT NULL,

    INDEX `role_permissions_permissionId_roleId_idx`(`permissionId`, `roleId`),
    PRIMARY KEY (`roleId`, `permissionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `auth_sessions` (
    `id` VARCHAR(30) NOT NULL,
    `userId` VARCHAR(30) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `auth_sessions_tokenHash_key`(`tokenHash`),
    INDEX `auth_sessions_userId_expiresAt_idx`(`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policies` (
    `id` VARCHAR(30) NOT NULL,
    `kind` ENUM('PRIVACY', 'TERMS', 'SUPPORT', 'DATA_REQUEST') NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `title` VARCHAR(180) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `policies_kind_key`(`kind`),
    UNIQUE INDEX `policies_slug_key`(`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `policy_revisions` (
    `id` VARCHAR(30) NOT NULL,
    `policyId` VARCHAR(30) NOT NULL,
    `revision` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `title` VARCHAR(180) NOT NULL,
    `contentHtml` LONGTEXT NOT NULL,
    `contentHash` VARCHAR(64) NOT NULL,
    `createdById` VARCHAR(30) NOT NULL,
    `publishedById` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `publishedAt` DATETIME(3) NULL,

    INDEX `policy_revisions_policyId_status_publishedAt_idx`(`policyId`, `status`, `publishedAt`),
    UNIQUE INDEX `policy_revisions_policyId_revision_key`(`policyId`, `revision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id` VARCHAR(30) NOT NULL,
    `username` VARCHAR(64) NOT NULL,
    `legacyParishAdminId` INTEGER NULL,
    `email` VARCHAR(191) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `displayName` VARCHAR(120) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `authVersion` INTEGER NOT NULL DEFAULT 1,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_legacyParishAdminId_key`(`legacyParishAdminId`),
    UNIQUE INDEX `users_email_key`(`email`),
    INDEX `users_displayName_idx`(`displayName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_deletion_requests` (
    `id` VARCHAR(30) NOT NULL,
    `requestKey` VARCHAR(64) NOT NULL,
    `requesterId` VARCHAR(30) NOT NULL,
    `activeRequesterId` VARCHAR(30) NULL,
    `status` ENUM('SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED', 'EXECUTED') NOT NULL DEFAULT 'SUBMITTED',
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

    UNIQUE INDEX `account_deletion_requests_requestKey_key`(`requestKey`),
    UNIQUE INDEX `account_deletion_requests_activeRequesterId_key`(`activeRequesterId`),
    INDEX `account_deletion_requests_status_submittedAt_idx`(`status`, `submittedAt`),
    INDEX `account_deletion_requests_requesterId_submittedAt_idx`(`requesterId`, `submittedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `account_deletion_events` (
    `id` VARCHAR(30) NOT NULL,
    `requestId` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `type` ENUM('SUBMITTED', 'REVIEW_STARTED', 'VERIFIED', 'APPROVED', 'REJECTED', 'EXECUTED') NOT NULL,
    `fromStatus` ENUM('SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED', 'EXECUTED') NULL,
    `toStatus` ENUM('SUBMITTED', 'IN_REVIEW', 'VERIFIED', 'APPROVED', 'REJECTED', 'EXECUTED') NOT NULL,
    `reason` TEXT NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `account_deletion_events_requestId_createdAt_idx`(`requestId`, `createdAt`),
    INDEX `account_deletion_events_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `academic_years` (
    `id` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `academic_years_name_key`(`name`),
    INDEX `academic_years_status_name_idx`(`status`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `semesters` (
    `id` VARCHAR(30) NOT NULL,
    `academicYearId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `semesters_academicYearId_status_idx`(`academicYearId`, `status`),
    UNIQUE INDEX `semesters_academicYearId_name_key`(`academicYearId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `catechism_classes` (
    `id` VARCHAR(30) NOT NULL,
    `academicYearId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `catechism_classes_academicYearId_status_name_idx`(`academicYearId`, `status`, `name`),
    UNIQUE INDEX `catechism_classes_academicYearId_name_key`(`academicYearId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `students` (
    `id` VARCHAR(30) NOT NULL,
    `saintName` VARCHAR(120) NOT NULL,
    `fullName` VARCHAR(180) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `students_fullName_idx`(`fullName`),
    INDEX `students_saintName_idx`(`saintName`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_columns` (
    `id` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `semesterId` VARCHAR(30) NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `minimum` DECIMAL(18, 6) NOT NULL,
    `maximum` DECIMAL(18, 6) NOT NULL,
    `precision` INTEGER NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grade_columns_classId_semesterId_idx`(`classId`, `semesterId`),
    UNIQUE INDEX `grade_columns_classId_semesterId_name_key`(`classId`, `semesterId`, `name`),
    UNIQUE INDEX `grade_columns_id_classId_semesterId_key`(`id`, `classId`, `semesterId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_records` (
    `id` VARCHAR(30) NOT NULL,
    `studentId` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `semesterId` VARCHAR(30) NOT NULL,
    `gradeColumnId` VARCHAR(30) NOT NULL,
    `value` DECIMAL(18, 6) NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `grade_records_classId_semesterId_studentId_idx`(`classId`, `semesterId`, `studentId`),
    UNIQUE INDEX `grade_records_studentId_classId_semesterId_gradeColumnId_key`(`studentId`, `classId`, `semesterId`, `gradeColumnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `grade_audit_entries` (
    `id` VARCHAR(30) NOT NULL,
    `gradeRecordId` VARCHAR(30) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `fingerprint` CHAR(64) NOT NULL,
    `beforeValue` DECIMAL(18, 6) NULL,
    `afterValue` DECIMAL(18, 6) NOT NULL,
    `beforeRevision` INTEGER NULL,
    `afterRevision` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `grade_audit_entries_requestId_key`(`requestId`),
    INDEX `grade_audit_entries_gradeRecordId_createdAt_idx`(`gradeRecordId`, `createdAt`),
    INDEX `grade_audit_entries_actorId_createdAt_idx`(`actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classification_rule_versions` (
    `id` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `semesterId` VARCHAR(30) NOT NULL,
    `version` INTEGER NOT NULL,
    `status` ENUM('DRAFT', 'PUBLISHED') NOT NULL DEFAULT 'DRAFT',
    `decimalPlaces` INTEGER NOT NULL,
    `roundingMethod` ENUM('HALF_UP', 'HALF_EVEN', 'DOWN', 'UP') NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 0,
    `publishedAt` DATETIME(3) NULL,
    `publishedById` VARCHAR(30) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `rule_versions_scope_status_idx`(`classId`, `semesterId`, `status`, `version`),
    UNIQUE INDEX `rule_versions_scope_version_key`(`classId`, `semesterId`, `version`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classification_rule_weights` (
    `id` VARCHAR(30) NOT NULL,
    `ruleVersionId` VARCHAR(30) NOT NULL,
    `gradeColumnId` VARCHAR(30) NOT NULL,
    `weight` DECIMAL(18, 6) NOT NULL,

    UNIQUE INDEX `rule_weights_version_column_key`(`ruleVersionId`, `gradeColumnId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classification_rule_bands` (
    `id` VARCHAR(30) NOT NULL,
    `ruleVersionId` VARCHAR(30) NOT NULL,
    `minimumInclusive` DECIMAL(18, 6) NOT NULL,
    `label` VARCHAR(120) NOT NULL,

    INDEX `rule_bands_version_minimum_idx`(`ruleVersionId`, `minimumInclusive`),
    UNIQUE INDEX `rule_bands_version_minimum_key`(`ruleVersionId`, `minimumInclusive`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `classification_results` (
    `id` VARCHAR(30) NOT NULL,
    `studentId` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `semesterId` VARCHAR(30) NOT NULL,
    `ruleVersionId` VARCHAR(30) NOT NULL,
    `resultRevision` INTEGER NOT NULL,
    `weightedAverage` DECIMAL(18, 6) NOT NULL,
    `roundedAverage` DECIMAL(18, 6) NOT NULL,
    `classificationLabel` VARCHAR(120) NOT NULL,
    `inputSnapshot` JSON NOT NULL,
    `inputFingerprint` CHAR(64) NOT NULL,
    `requestId` VARCHAR(64) NOT NULL,
    `actorId` VARCHAR(30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `classification_results_requestId_key`(`requestId`),
    INDEX `results_class_semester_created_idx`(`classId`, `semesterId`, `createdAt`),
    INDEX `results_student_semester_created_idx`(`studentId`, `semesterId`, `createdAt`),
    INDEX `results_rule_version_idx`(`ruleVersionId`),
    UNIQUE INDEX `results_scope_revision_key`(`studentId`, `classId`, `semesterId`, `resultRevision`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

-- CreateTable
CREATE TABLE `enrollments` (
    `id` VARCHAR(30) NOT NULL,
    `studentId` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `academicYearId` VARCHAR(30) NOT NULL,
    `currentKey` VARCHAR(70) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    UNIQUE INDEX `enrollments_currentKey_key`(`currentKey`),
    INDEX `enrollments_studentId_academicYearId_endedAt_idx`(`studentId`, `academicYearId`, `endedAt`),
    INDEX `enrollments_classId_endedAt_idx`(`classId`, `endedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `teacher_assignments` (
    `id` VARCHAR(30) NOT NULL,
    `teacherId` VARCHAR(30) NOT NULL,
    `classId` VARCHAR(30) NOT NULL,
    `currentKey` VARCHAR(70) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    UNIQUE INDEX `teacher_assignments_currentKey_key`(`currentKey`),
    INDEX `teacher_assignments_teacherId_endedAt_idx`(`teacherId`, `endedAt`),
    INDEX `teacher_assignments_classId_endedAt_idx`(`classId`, `endedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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
ALTER TABLE `Post` ADD CONSTRAINT `Post_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Post` ADD CONSTRAINT `Post_featuredImageId_fkey` FOREIGN KEY (`featuredImageId`) REFERENCES `Media`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Category` ADD CONSTRAINT `Category_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `Media`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostCategory` ADD CONSTRAINT `PostCategory_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostCategory` ADD CONSTRAINT `PostCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostTag` ADD CONSTRAINT `PostTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Media` ADD CONSTRAINT `Media_uploadedById_fkey` FOREIGN KEY (`uploadedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMedia` ADD CONSTRAINT `PostMedia_postId_fkey` FOREIGN KEY (`postId`) REFERENCES `Post`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PostMedia` ADD CONSTRAINT `PostMedia_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuItem` ADD CONSTRAINT `MenuItem_menuId_fkey` FOREIGN KEY (`menuId`) REFERENCES `Menu`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `MenuItem` ADD CONSTRAINT `MenuItem_parentId_fkey` FOREIGN KEY (`parentId`) REFERENCES `MenuItem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `HomeSection` ADD CONSTRAINT `HomeSection_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `Category`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumMedia` ADD CONSTRAINT `AlbumMedia_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `Album`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AlbumMedia` ADD CONSTRAINT `AlbumMedia_mediaId_fkey` FOREIGN KEY (`mediaId`) REFERENCES `Media`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_assignments` ADD CONSTRAINT `user_role_assignments_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `user_role_assignments` ADD CONSTRAINT `user_role_assignments_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `access_roles`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `access_roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `role_permissions` ADD CONSTRAINT `role_permissions_permissionId_fkey` FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `auth_sessions` ADD CONSTRAINT `auth_sessions_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_revisions` ADD CONSTRAINT `policy_revisions_policyId_fkey` FOREIGN KEY (`policyId`) REFERENCES `policies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_revisions` ADD CONSTRAINT `policy_revisions_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `policy_revisions` ADD CONSTRAINT `policy_revisions_publishedById_fkey` FOREIGN KEY (`publishedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_deletion_requests` ADD CONSTRAINT `account_deletion_requests_requesterId_fkey` FOREIGN KEY (`requesterId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_deletion_events` ADD CONSTRAINT `account_deletion_events_requestId_fkey` FOREIGN KEY (`requestId`) REFERENCES `account_deletion_requests`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `account_deletion_events` ADD CONSTRAINT `account_deletion_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `semesters` ADD CONSTRAINT `semesters_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `catechism_classes` ADD CONSTRAINT `catechism_classes_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_columns` ADD CONSTRAINT `grade_columns_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_columns` ADD CONSTRAINT `grade_columns_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_records` ADD CONSTRAINT `grade_records_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_records` ADD CONSTRAINT `grade_records_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_records` ADD CONSTRAINT `grade_records_semesterId_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_records` ADD CONSTRAINT `grade_records_gradeColumnId_classId_semesterId_fkey` FOREIGN KEY (`gradeColumnId`, `classId`, `semesterId`) REFERENCES `grade_columns`(`id`, `classId`, `semesterId`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_audit_entries` ADD CONSTRAINT `grade_audit_entries_gradeRecordId_fkey` FOREIGN KEY (`gradeRecordId`) REFERENCES `grade_records`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `grade_audit_entries` ADD CONSTRAINT `grade_audit_entries_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_versions` ADD CONSTRAINT `rule_versions_class_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_versions` ADD CONSTRAINT `rule_versions_semester_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_versions` ADD CONSTRAINT `rule_versions_publisher_fkey` FOREIGN KEY (`publishedById`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_weights` ADD CONSTRAINT `rule_weights_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_weights` ADD CONSTRAINT `rule_weights_column_fkey` FOREIGN KEY (`gradeColumnId`) REFERENCES `grade_columns`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_rule_bands` ADD CONSTRAINT `rule_bands_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_results` ADD CONSTRAINT `results_student_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_results` ADD CONSTRAINT `results_class_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_results` ADD CONSTRAINT `results_semester_fkey` FOREIGN KEY (`semesterId`) REFERENCES `semesters`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_results` ADD CONSTRAINT `results_rule_version_fkey` FOREIGN KEY (`ruleVersionId`) REFERENCES `classification_rule_versions`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `classification_results` ADD CONSTRAINT `results_actor_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_batches` ADD CONSTRAINT `student_import_batches_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_batches` ADD CONSTRAINT `student_import_batches_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_rows` ADD CONSTRAINT `student_import_rows_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `student_import_batches`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_rows` ADD CONSTRAINT `student_import_rows_createdStudentId_fkey` FOREIGN KEY (`createdStudentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_events` ADD CONSTRAINT `student_import_events_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `student_import_batches`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `student_import_events` ADD CONSTRAINT `student_import_events_actorId_fkey` FOREIGN KEY (`actorId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_assignments` ADD CONSTRAINT `teacher_assignments_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `teacher_assignments` ADD CONSTRAINT `teacher_assignments_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

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
