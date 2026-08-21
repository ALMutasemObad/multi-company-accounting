-- Expand company-scoped automatic codes to all user-created reference codes
-- that do not carry an accounting, ISO, or authorization-contract meaning.
ALTER TABLE `master_data_code_sequences`
  MODIFY `prefix` VARCHAR(32) NOT NULL;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'COST_CENTER', 'CC-',
  COALESCE(MAX(CASE
    WHEN TRIM(`cost_centers`.`code`) REGEXP '^CC-[0-9]+$'
      THEN CAST(SUBSTRING(TRIM(`cost_centers`.`code`), 4) AS UNSIGNED)
    ELSE 0 END), 0) + 1,
  6, CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `cost_centers` ON `cost_centers`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'CASH_BANK_ACCOUNT', 'CB-',
  COALESCE(MAX(CASE
    WHEN TRIM(`cash_bank_accounts`.`code`) REGEXP '^CB-[0-9]+$'
      THEN CAST(SUBSTRING(TRIM(`cash_bank_accounts`.`code`), 4) AS UNSIGNED)
    ELSE 0 END), 0) + 1,
  6, CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `cash_bank_accounts` ON `cash_bank_accounts`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'PAYMENT_METHOD', CONCAT('PM-', `companies`.`id`, '-'),
  COALESCE(MAX(CASE
    WHEN TRIM(`payment_methods`.`code`) REGEXP CONCAT('^PM-', `companies`.`id`, '-[0-9]+$')
      THEN CAST(SUBSTRING(TRIM(`payment_methods`.`code`), CHAR_LENGTH(CONCAT('PM-', `companies`.`id`, '-')) + 1) AS UNSIGNED)
    ELSE 0 END), 0) + 1,
  6, CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `payment_methods` ON `payment_methods`.`company_id` = `companies`.`id`
  AND `payment_methods`.`scope` = 'COMPANY'
GROUP BY `companies`.`id`;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'TAX_RATE', 'TAX-',
  COALESCE(MAX(CASE
    WHEN TRIM(`tax_rates`.`code`) REGEXP '^TAX-[0-9]+$'
      THEN CAST(SUBSTRING(TRIM(`tax_rates`.`code`), 5) AS UNSIGNED)
    ELSE 0 END), 0) + 1,
  6, CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `tax_rates` ON `tax_rates`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'CUSTOM_ROLE', 'ROL-',
  COALESCE(MAX(CASE
    WHEN TRIM(`roles`.`code`) REGEXP '^ROL-[0-9]+$'
      THEN CAST(SUBSTRING(TRIM(`roles`.`code`), 5) AS UNSIGNED)
    ELSE 0 END), 0) + 1,
  6, CURRENT_TIMESTAMP(3)
FROM `companies`
LEFT JOIN `roles` ON `roles`.`company_id` = `companies`.`id`
GROUP BY `companies`.`id`;

-- One-time, opaque password-reset requests. Plain reset tokens are never stored.
CREATE TABLE `password_reset_requests` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` VARCHAR(80) NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `locale` VARCHAR(10) NOT NULL DEFAULT 'ar',
  `token_hash` BINARY(32) NULL,
  `expires_at` DATETIME(3) NULL,
  `status` ENUM('PENDING', 'USED', 'REVOKED') NOT NULL DEFAULT 'PENDING',
  `delivery_status` ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING',
  `delivery_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `last_error_code` VARCHAR(80) NULL,
  `requested_ip_address` VARCHAR(64) NULL,
  `requested_user_agent` VARCHAR(500) NULL,
  `used_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `password_reset_requests_public_id_key` (`public_id`),
  UNIQUE INDEX `password_reset_requests_token_hash_key` (`token_hash`),
  INDEX `password_reset_requests_user_id_status_created_at_idx` (`user_id`, `status`, `created_at`),
  INDEX `password_reset_requests_status_expires_at_idx` (`status`, `expires_at`),
  CONSTRAINT `password_reset_requests_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
