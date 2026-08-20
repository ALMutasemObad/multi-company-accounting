-- Add stable tenant keys without invalidating existing development data.
ALTER TABLE `organizations` ADD COLUMN `code` VARCHAR(80) NULL;
UPDATE `organizations` SET `code` = CONCAT('ORG-', `id`) WHERE `code` IS NULL;
ALTER TABLE `organizations` MODIFY `code` VARCHAR(80) NOT NULL;
CREATE UNIQUE INDEX `organizations_code_key` ON `organizations`(`code`);

ALTER TABLE `companies` ADD COLUMN `code` VARCHAR(80) NULL;
UPDATE `companies` SET `code` = CONCAT('COMPANY-', `id`) WHERE `code` IS NULL;
ALTER TABLE `companies` MODIFY `code` VARCHAR(80) NOT NULL;
CREATE UNIQUE INDEX `companies_organization_id_code_key` ON `companies`(`organization_id`, `code`);
