CREATE TABLE `pos_sales` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `sales_invoice_id` BIGINT UNSIGNED NOT NULL,
  `receipt_id` BIGINT UNSIGNED NOT NULL,
  `completed_by_id` BIGINT UNSIGNED NOT NULL,
  `completed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `pos_sales_sales_invoice_id_key` (`sales_invoice_id`),
  UNIQUE KEY `pos_sales_receipt_id_key` (`receipt_id`),
  UNIQUE KEY `pos_sales_id_company_id_key` (`id`, `company_id`),
  UNIQUE KEY `pos_sales_sales_invoice_company_key` (`sales_invoice_id`, `company_id`),
  UNIQUE KEY `pos_sales_receipt_company_key` (`receipt_id`, `company_id`),
  KEY `pos_sales_company_completed_id_idx` (`company_id`, `completed_at`, `id`),
  KEY `pos_sales_completed_by_at_idx` (`completed_by_id`, `completed_at`),
  CONSTRAINT `pos_sales_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `pos_sales_sales_invoice_company_fkey` FOREIGN KEY (`sales_invoice_id`, `company_id`) REFERENCES `sales_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `pos_sales_receipt_company_fkey` FOREIGN KEY (`receipt_id`, `company_id`) REFERENCES `receipts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `pos_sales_completed_by_id_fkey` FOREIGN KEY (`completed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('pos.view', 'pos', 'عرض شاشة نقاط البيع والمبيعات النقدية'),
  ('pos.checkout', 'pos', 'تنفيذ بيع نقدي كامل عبر نقاط البيع')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('pos.view', 'pos.checkout')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
