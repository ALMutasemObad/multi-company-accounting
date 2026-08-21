-- Company-scoped currency enablement and dated exchange rates.
CREATE TABLE `company_currencies` (
  `company_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  INDEX `company_currencies_currency_id_idx`(`currency_id`),
  PRIMARY KEY (`company_id`, `currency_id`),
  CONSTRAINT `company_currencies_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `company_currencies_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `company_exchange_rates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `rate_date` DATE NOT NULL,
  `rate` DECIMAL(19, 8) NOT NULL,
  `source` VARCHAR(100) NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,

  UNIQUE INDEX `company_exchange_rates_company_id_currency_id_rate_date_key`(`company_id`, `currency_id`, `rate_date`),
  INDEX `company_exchange_rates_updated_by_id_idx`(`updated_by_id`),
  INDEX `company_exchange_rates_company_id_rate_date_idx`(`company_id`, `rate_date`),
  PRIMARY KEY (`id`),
  CONSTRAINT `company_exchange_rates_rate_positive` CHECK (`rate` > 0),
  CONSTRAINT `company_exchange_rates_company_id_currency_id_fkey` FOREIGN KEY (`company_id`, `currency_id`) REFERENCES `company_currencies`(`company_id`, `currency_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `company_exchange_rates_updated_by_id_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve every existing company by enabling its current base currency.
INSERT INTO `company_currencies` (`company_id`, `currency_id`, `is_active`, `created_at`, `updated_at`)
SELECT `id`, `base_currency_id`, true, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `companies`;
