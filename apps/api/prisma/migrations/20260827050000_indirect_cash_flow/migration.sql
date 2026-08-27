CREATE TABLE `cash_flow_account_mappings` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `account_id` BIGINT UNSIGNED NOT NULL,
  `classification` ENUM('NET_INCOME', 'OPERATING_ADJUSTMENT', 'OPERATING_WORKING_CAPITAL', 'INVESTING', 'FINANCING', 'EXCLUDED') NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `cash_flow_account_mappings_company_id_account_id_key` (`company_id`, `account_id`),
  INDEX `cash_flow_account_mappings_company_class_account_idx` (`company_id`, `classification`, `account_id`),
  INDEX `cash_flow_account_mappings_created_by_created_at_idx` (`created_by_id`, `created_at`),
  INDEX `cash_flow_account_mappings_updated_by_updated_at_idx` (`updated_by_id`, `updated_at`),
  CONSTRAINT `cash_flow_account_mappings_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `cash_flow_account_mappings_account_company_fkey` FOREIGN KEY (`account_id`, `company_id`) REFERENCES `accounts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `cash_flow_account_mappings_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `cash_flow_account_mappings_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('reports.cash_flow.view', 'reports', 'عرض قائمة التدفق النقدي بالطريقة غير المباشرة'),
  ('reports.cash_flow.manage', 'reports', 'إدارة تصنيف حسابات قائمة التدفق النقدي')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('reports.cash_flow.view', 'reports.cash_flow.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR';
