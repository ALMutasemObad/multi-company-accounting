CREATE TABLE `sales_item_selling_profiles` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `unit_price` DECIMAL(19,4) NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `revenue_account_id` BIGINT UNSIGNED NOT NULL,
  `tax_rate_id` BIGINT UNSIGNED NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `version` INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `selling_profiles_company_item_key` (`company_id`, `inventory_item_id`),
  KEY `selling_profiles_item_company_idx` (`inventory_item_id`, `company_id`),
  KEY `selling_profiles_company_currency_idx` (`company_id`, `currency_id`),
  KEY `selling_profiles_revenue_company_idx` (`revenue_account_id`, `company_id`),
  KEY `selling_profiles_tax_company_idx` (`tax_rate_id`, `company_id`),
  CONSTRAINT `selling_profiles_price_nonnegative` CHECK (`unit_price` >= 0),
  CONSTRAINT `selling_profiles_version_positive` CHECK (`version` >= 1),
  CONSTRAINT `selling_profiles_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `selling_profiles_item_company_fk` FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `selling_profiles_currency_company_fk` FOREIGN KEY (`company_id`, `currency_id`) REFERENCES `company_currencies` (`company_id`, `currency_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `selling_profiles_revenue_company_fk` FOREIGN KEY (`revenue_account_id`, `company_id`) REFERENCES `accounts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `selling_profiles_tax_company_fk` FOREIGN KEY (`tax_rate_id`, `company_id`) REFERENCES `tax_rates` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('sales_catalog.view', 'sales_catalog', 'عرض كتالوج البيع وملفات بيع الأصناف'),
  ('sales_catalog.manage', 'sales_catalog', 'إدارة السعر والعملة والحساب والضريبة الافتراضية للصنف')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('sales_catalog.view', 'sales_catalog.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
