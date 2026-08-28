CREATE TABLE `professional_service_contracts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `contract_reference` VARCHAR(120) NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `payment_terms_days` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
  `end_reason` VARCHAR(500) NULL,
  `ended_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_service_contracts_public_id_key` (`public_id`),
  UNIQUE KEY `professional_service_contracts_id_company_key` (`id`, `company_id`),
  KEY `professional_contracts_project_period_idx` (`company_id`, `project_id`, `effective_from`, `effective_to`),
  KEY `professional_contracts_status_period_idx` (`company_id`, `status`, `effective_from`),
  CONSTRAINT `professional_contracts_dates_chk` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`),
  CONSTRAINT `professional_contracts_terms_chk` CHECK (`payment_terms_days` <= 365),
  CONSTRAINT `professional_contracts_end_state_chk` CHECK (
    (`status` = 'ACTIVE' AND `end_reason` IS NULL AND `ended_at` IS NULL)
    OR (`status` = 'ENDED' AND `effective_to` IS NOT NULL AND `end_reason` IS NOT NULL AND `ended_at` IS NOT NULL)
  ),
  CONSTRAINT `professional_contracts_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_contracts_project_fkey` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_contracts_currency_fkey` FOREIGN KEY (`company_id`, `currency_id`) REFERENCES `company_currencies` (`company_id`, `currency_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_contracts_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_contracts_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_service_rates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `contract_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `hourly_rate` DECIMAL(19,4) NOT NULL,
  `effective_from` DATE NOT NULL,
  `effective_to` DATE NULL,
  `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
  `end_reason` VARCHAR(500) NULL,
  `ended_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_service_rates_public_id_key` (`public_id`),
  UNIQUE KEY `professional_service_rates_id_company_key` (`id`, `company_id`),
  KEY `professional_rates_contract_user_period_idx` (`company_id`, `contract_id`, `user_id`, `effective_from`, `effective_to`),
  KEY `professional_rates_user_status_idx` (`company_id`, `user_id`, `status`),
  CONSTRAINT `professional_rates_dates_chk` CHECK (`effective_to` IS NULL OR `effective_to` >= `effective_from`),
  CONSTRAINT `professional_rates_amount_chk` CHECK (`hourly_rate` > 0),
  CONSTRAINT `professional_rates_end_state_chk` CHECK (
    (`status` = 'ACTIVE' AND `end_reason` IS NULL AND `ended_at` IS NULL)
    OR (`status` = 'ENDED' AND `effective_to` IS NOT NULL AND `end_reason` IS NOT NULL AND `ended_at` IS NOT NULL)
  ),
  CONSTRAINT `professional_rates_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_rates_contract_fkey` FOREIGN KEY (`contract_id`, `company_id`) REFERENCES `professional_service_contracts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_rates_assignment_fkey` FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_rates_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_rates_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_billing_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `contract_id` BIGINT UNSIGNED NOT NULL,
  `contract_version` INT UNSIGNED NOT NULL,
  `sales_invoice_id` BIGINT UNSIGNED NOT NULL,
  `source_date_from` DATE NOT NULL,
  `source_date_to` DATE NOT NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_billing_runs_public_id_key` (`public_id`),
  UNIQUE KEY `professional_billing_runs_sales_invoice_key` (`sales_invoice_id`),
  UNIQUE KEY `professional_billing_runs_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `professional_billing_runs_invoice_company_key` (`sales_invoice_id`, `company_id`),
  KEY `professional_billing_runs_project_created_idx` (`company_id`, `project_id`, `created_at`, `id`),
  KEY `professional_billing_runs_contract_period_idx` (`company_id`, `contract_id`, `source_date_from`, `source_date_to`),
  CONSTRAINT `professional_billing_runs_dates_chk` CHECK (`source_date_to` >= `source_date_from`),
  CONSTRAINT `professional_billing_runs_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_runs_project_fkey` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_runs_contract_fkey` FOREIGN KEY (`contract_id`, `company_id`) REFERENCES `professional_service_contracts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_runs_invoice_fkey` FOREIGN KEY (`sales_invoice_id`, `company_id`) REFERENCES `sales_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_runs_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_billing_source_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `billing_run_id` BIGINT UNSIGNED NOT NULL,
  `time_entry_id` BIGINT UNSIGNED NOT NULL,
  `time_entry_version` INT UNSIGNED NOT NULL,
  `service_rate_id` BIGINT UNSIGNED NOT NULL,
  `service_rate_version` INT UNSIGNED NOT NULL,
  `minutes` SMALLINT UNSIGNED NOT NULL,
  `hourly_rate_snapshot` DECIMAL(19,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_billing_source_time_entry_key` (`time_entry_id`),
  UNIQUE KEY `professional_billing_source_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `professional_billing_source_time_company_key` (`time_entry_id`, `company_id`),
  KEY `professional_billing_source_run_idx` (`company_id`, `billing_run_id`, `id`),
  KEY `professional_billing_source_rate_idx` (`company_id`, `service_rate_id`),
  CONSTRAINT `professional_billing_source_values_chk` CHECK (`minutes` > 0 AND `hourly_rate_snapshot` > 0),
  CONSTRAINT `professional_billing_source_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_source_run_fkey` FOREIGN KEY (`billing_run_id`, `company_id`) REFERENCES `professional_billing_runs` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_source_time_fkey` FOREIGN KEY (`time_entry_id`, `company_id`) REFERENCES `professional_time_entries` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_billing_source_rate_fkey` FOREIGN KEY (`service_rate_id`, `company_id`) REFERENCES `professional_service_rates` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('professional_contracts.view', 'professional_projects', 'عرض عقود الخدمات المهنية المؤرخة'),
  ('professional_contracts.manage', 'professional_projects', 'إنشاء وإنهاء عقود الخدمات المهنية'),
  ('professional_rates.view', 'professional_projects', 'عرض أسعار الخدمات المهنية الحساسة'),
  ('professional_rates.manage', 'professional_projects', 'إنشاء وإنهاء أسعار الخدمات المهنية الحساسة'),
  ('professional_billing.view', 'professional_projects', 'عرض تشغيلات فوترة الخدمات ومصادرها'),
  ('professional_billing.execute', 'professional_projects', 'تحويل الوقت المعتمد إلى فاتورة مبيعات مرحلة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'professional_contracts.view',
  'professional_contracts.manage',
  'professional_rates.view',
  'professional_rates.manage',
  'professional_billing.view',
  'professional_billing.execute'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
