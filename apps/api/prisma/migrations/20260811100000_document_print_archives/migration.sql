CREATE TABLE `document_print_archives` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `accounting_document_id` BIGINT UNSIGNED NOT NULL,
  `format_version` SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `snapshot` JSON NOT NULL,
  `snapshot_hash` CHAR(64) NOT NULL,
  `created_by` BIGINT UNSIGNED NOT NULL,
  `print_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `first_printed_at` DATETIME(3) NULL,
  `last_printed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `document_print_archives_accounting_document_id_key` (`accounting_document_id`),
  UNIQUE INDEX `document_print_archives_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `document_print_archives_accounting_document_id_company_id_key` (`accounting_document_id`, `company_id`),
  INDEX `document_print_archives_company_id_created_at_idx` (`company_id`, `created_at`),
  CONSTRAINT `document_print_archives_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `document_print_archives_accounting_document_id_company_id_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `document_print_archives_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('receipts.print', 'receipts', 'طباعة وأرشفة سندات القبض'),
  ('payments.print', 'payments', 'طباعة وأرشفة سندات الصرف'),
  ('manual_journals.print', 'manual_journals', 'طباعة وأرشفة القيود اليدوية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('receipts.print', 'payments.print', 'manual_journals.print')
WHERE `roles`.`code` = 'ADMINISTRATOR';
