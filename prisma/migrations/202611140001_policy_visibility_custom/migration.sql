ALTER TABLE `policies` MODIFY `kind` ENUM('PRIVACY', 'TERMS', 'SUPPORT', 'DATA_REQUEST') NULL;
ALTER TABLE `policies` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT false;
UPDATE `policies` p SET `isActive` = true WHERE EXISTS (
  SELECT 1 FROM `policy_revisions` r WHERE r.`policyId` = p.`id` AND r.`status` = 'PUBLISHED'
);
CREATE INDEX `policies_isActive_idx` ON `policies`(`isActive`);
