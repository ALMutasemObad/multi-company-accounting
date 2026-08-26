-- Close the manual stock loop: every new valued external movement receives an
-- atomic accounting document, while transfers remain quantity/value neutral.
ALTER TABLE `accounting_documents`
  MODIFY `document_type` ENUM(
    'MANUAL_JOURNAL',
    'INVENTORY_ADJUSTMENT',
    'RECEIPT',
    'PAYMENT',
    'PERIOD_CLOSE',
    'SALES_INVOICE',
    'SALES_CREDIT_NOTE',
    'PURCHASE_INVOICE',
    'PURCHASE_DEBIT_NOTE'
  ) NOT NULL;

ALTER TABLE `inventory_movements`
  ADD COLUMN `accounting_document_id` BIGINT UNSIGNED NULL AFTER `source_document_number_snapshot`,
  ADD COLUMN `offset_account_id` BIGINT UNSIGNED NULL AFTER `accounting_document_id`,
  ADD COLUMN `reversal_of_movement_id` BIGINT UNSIGNED NULL AFTER `offset_account_id`,
  ADD COLUMN `status` ENUM('POSTED', 'REVERSED') NOT NULL DEFAULT 'POSTED' AFTER `reversal_of_movement_id`,
  ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `status`,
  ADD UNIQUE INDEX `inventory_movements_accounting_document_company_key`
    (`accounting_document_id`, `company_id`),
  ADD UNIQUE INDEX `inventory_movements_reversal_company_key`
    (`reversal_of_movement_id`, `company_id`),
  ADD INDEX `inventory_movements_offset_account_company_idx`
    (`offset_account_id`, `company_id`),
  ADD CONSTRAINT `inventory_movements_accounting_document_company_fk`
    FOREIGN KEY (`accounting_document_id`, `company_id`)
    REFERENCES `accounting_documents` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_movements_offset_account_company_fk`
    FOREIGN KEY (`offset_account_id`, `company_id`)
    REFERENCES `accounts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `inventory_movements_reversal_company_fk`
    FOREIGN KEY (`reversal_of_movement_id`, `company_id`)
    REFERENCES `inventory_movements` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

-- MariaDB rejects CHECK expressions that reference an AUTO_INCREMENT column
-- (error 1901), including the natural `reversal_of_movement_id <> id` guard.
-- The application creates reversals only through the locked reverse command;
-- the composite FK and unique key remain database-enforced, while the service
-- rejects reversing a reversal or assigning any caller-provided source link.

-- Preserve the lifecycle of invoice movements that were reversed before this
-- migration. Source uniqueness guarantees at most one POST and one REVERSE row
-- for the same invoice event, so the backfill is deterministic.
UPDATE `inventory_movements` AS `reversal`
JOIN `inventory_movements` AS `original`
  ON `original`.`company_id` = `reversal`.`company_id`
  AND `original`.`source_type` = `reversal`.`source_type`
  AND `original`.`source_id` = `reversal`.`source_id`
  AND `original`.`source_event` = 'POST'
SET
  `reversal`.`reversal_of_movement_id` = `original`.`id`,
  `original`.`status` = 'REVERSED',
  `original`.`version` = `original`.`version` + 1
WHERE `reversal`.`source_event` = 'REVERSE'
  AND `reversal`.`reversal_of_movement_id` IS NULL
  AND `original`.`status` = 'POSTED';

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES ('inventory_movements.reverse', 'inventory', 'عكس حركات المخزون اليدوية')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'inventory_movements.reverse'
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = true;
