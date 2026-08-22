CREATE TABLE `data_import_batches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `import_type` ENUM('CUSTOMERS', 'SUPPLIERS', 'SALES_INVOICES', 'PURCHASE_INVOICES') NOT NULL,
  `source_format` ENUM('CSV', 'XLSX') NOT NULL,
  `file_hash` BINARY(32) NOT NULL,
  `row_count` SMALLINT UNSIGNED NOT NULL,
  `valid_row_count` SMALLINT UNSIGNED NOT NULL,
  `error_row_count` SMALLINT UNSIGNED NOT NULL,
  `status` ENUM('PREVIEWED', 'COMMITTED', 'EXPIRED') NOT NULL DEFAULT 'PREVIEWED',
  `expires_at` DATETIME(3) NOT NULL,
  `committed_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `data_import_batches_public_id_key`(`public_id`),
  INDEX `data_import_batches_company_status_created_idx`(`company_id`, `status`, `created_at`),
  INDEX `data_import_batches_created_by_created_idx`(`created_by_id`, `created_at`),
  INDEX `data_import_batches_status_expires_idx`(`status`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `data_import_batches_counts_chk` CHECK (`row_count` > 0 AND `valid_row_count` + `error_row_count` = `row_count`),
  CONSTRAINT `data_import_batches_commit_chk` CHECK ((`status` = 'COMMITTED' AND `committed_at` IS NOT NULL) OR (`status` <> 'COMMITTED' AND `committed_at` IS NULL))
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `data_import_batches`
  ADD CONSTRAINT `data_import_batches_company_id_fkey`
  FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `data_import_batches`
  ADD CONSTRAINT `data_import_batches_created_by_id_fkey`
  FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('data_imports.view', 'data_imports', 'عرض قوالب ومعاينات وسجل استيراد البيانات'),
  ('data_imports.execute', 'data_imports', 'تنفيذ استيراد البيانات بعد المعاينة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('data_imports.view', 'data_imports.execute')
WHERE `roles`.`code` = 'ADMINISTRATOR';
