-- Keep the field nullable so existing installations can migrate safely.
-- The seed/update step assigns the username without storing credentials here.
ALTER TABLE `Admin` ADD COLUMN `username` VARCHAR(191) NULL;
CREATE UNIQUE INDEX `Admin_username_key` ON `Admin`(`username`);
