ALTER TABLE `cash_bank_accounts`
  ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `is_active`;

ALTER TABLE `payment_methods`
  ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `is_active`;
