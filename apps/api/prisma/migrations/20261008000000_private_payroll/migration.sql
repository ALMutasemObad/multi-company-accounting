-- Expand only. No module activation and no plaintext salary columns.
CREATE TABLE `payroll_company_scopes` (
  `company_id` BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  CONSTRAINT `payroll_company_scopes_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payroll_pay_agreements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `starts_on` DATE NOT NULL,
  `ends_before` DATE NULL,
  `encrypted_terms` JSON NOT NULL,
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `payroll_pay_agreements_public_id_key` (`public_id`),
  UNIQUE INDEX `payroll_pay_agreements_id_company_id_key` (`id`, `company_id`),
  INDEX `payroll_pay_agreements_company_id_employee_id_starts_on_ends_idx` (`company_id`, `employee_id`, `starts_on`, `ends_before`),
  CONSTRAINT `payroll_pay_agreements_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_pay_agreements_employee_id_company_id_fkey` FOREIGN KEY (`employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_pay_agreements_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_pay_agreements_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payroll_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `period_start` DATE NOT NULL,
  `period_end_exclusive` DATE NOT NULL,
  `status` VARCHAR(24) NOT NULL DEFAULT 'DRAFT',
  `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `maker_user_id` BIGINT UNSIGNED NOT NULL,
  `employee_count` INTEGER UNSIGNED NOT NULL DEFAULT 0,
  `encrypted_snapshot` JSON NULL,
  `snapshot_hash` CHAR(64) NULL,
  `approved_by_user_id` BIGINT UNSIGNED NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `payroll_runs_public_id_key` (`public_id`),
  UNIQUE INDEX `payroll_runs_id_company_id_key` (`id`, `company_id`),
  INDEX `payroll_runs_company_id_period_start_period_end_exclusive_idx` (`company_id`, `period_start`, `period_end_exclusive`),
  CONSTRAINT `payroll_runs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_runs_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_runs_maker_user_id_fkey` FOREIGN KEY (`maker_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `payroll_runs_approved_by_user_id_fkey` FOREIGN KEY (`approved_by_user_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
