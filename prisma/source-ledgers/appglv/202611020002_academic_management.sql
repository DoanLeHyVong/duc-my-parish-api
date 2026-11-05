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

CREATE TABLE `semesters` (
  `id` VARCHAR(30) NOT NULL,
  `academicYearId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `semesters_academicYearId_name_key`(`academicYearId`, `name`),
  INDEX `semesters_academicYearId_status_idx`(`academicYearId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `catechism_classes` (
  `id` VARCHAR(30) NOT NULL,
  `academicYearId` VARCHAR(30) NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `closedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `catechism_classes_academicYearId_name_key`(`academicYearId`, `name`),
  INDEX `catechism_classes_academicYearId_status_name_idx`(`academicYearId`, `status`, `name`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

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

ALTER TABLE `semesters` ADD CONSTRAINT `semesters_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `catechism_classes` ADD CONSTRAINT `catechism_classes_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_studentId_fkey` FOREIGN KEY (`studentId`) REFERENCES `students`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `enrollments` ADD CONSTRAINT `enrollments_academicYearId_fkey` FOREIGN KEY (`academicYearId`) REFERENCES `academic_years`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `teacher_assignments` ADD CONSTRAINT `teacher_assignments_teacherId_fkey` FOREIGN KEY (`teacherId`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `teacher_assignments` ADD CONSTRAINT `teacher_assignments_classId_fkey` FOREIGN KEY (`classId`) REFERENCES `catechism_classes`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

