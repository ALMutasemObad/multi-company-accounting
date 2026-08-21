-- Company-owned currencies while preserving the shared global catalogue.
ALTER TABLE `currencies`
  DROP INDEX `currencies_code_key`,
  ADD COLUMN `scope` ENUM('GLOBAL', 'COMPANY') NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN `scope_key` VARCHAR(40) NOT NULL DEFAULT 'GLOBAL',
  ADD COLUMN `owner_company_id` BIGINT UNSIGNED NULL;

CREATE UNIQUE INDEX `currencies_scope_key_code_key` ON `currencies`(`scope_key`, `code`);
CREATE INDEX `currencies_owner_company_id_is_active_idx` ON `currencies`(`owner_company_id`, `is_active`);

ALTER TABLE `currencies`
  ADD CONSTRAINT `currencies_owner_company_id_fkey`
    FOREIGN KEY (`owner_company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `currencies_scope_key_consistency`
    CHECK (
      (`scope` = 'GLOBAL' AND `scope_key` = 'GLOBAL')
      OR
      (`scope` = 'COMPANY' AND `scope_key` LIKE 'COMPANY:%')
    );
