CREATE TABLE `users` (
  `id` VARCHAR(30) NOT NULL,
  `username` VARCHAR(64) NOT NULL,
  `displayName` VARCHAR(120) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `role` ENUM('SUPER_ADMIN', 'TEACHER') NOT NULL,
  `isActive` BOOLEAN NOT NULL DEFAULT true,
  `authVersion` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  UNIQUE INDEX `users_username_key`(`username`),
  INDEX `users_role_isActive_idx`(`role`, `isActive`),
  INDEX `users_displayName_idx`(`displayName`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

