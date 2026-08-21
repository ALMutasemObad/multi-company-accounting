ALTER TABLE `accounts`
  ADD COLUMN `source_template_code` VARCHAR(80) NULL,
  ADD COLUMN `source_template_key` VARCHAR(80) NULL,
  ADD CONSTRAINT `accounts_template_fields_together`
    CHECK ((`source_template_code` IS NULL AND `source_template_key` IS NULL)
      OR (`source_template_code` IS NOT NULL AND `source_template_key` IS NOT NULL));

CREATE UNIQUE INDEX `accounts_company_id_source_template_code_source_template_key_key`
  ON `accounts`(`company_id`, `source_template_code`, `source_template_key`);
