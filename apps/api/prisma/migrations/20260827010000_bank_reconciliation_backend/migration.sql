CREATE TABLE `bank_statement_imports` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `cash_bank_account_id` BIGINT UNSIGNED NOT NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `format` ENUM('CSV', 'CAMT053') NOT NULL,
  `source_hash_sha256` BINARY(32) NOT NULL,
  `statement_id` VARCHAR(120) NULL,
  `account_identifier_last4` VARCHAR(4) NULL,
  `currency_code` CHAR(3) NOT NULL,
  `period_start` DATE NOT NULL,
  `period_end` DATE NOT NULL,
  `opening_balance` DECIMAL(19, 4) NULL,
  `closing_balance` DECIMAL(19, 4) NULL,
  `net_movement` DECIMAL(19, 4) NOT NULL,
  `line_count` SMALLINT UNSIGNED NOT NULL,
  `ignored_entry_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `status` ENUM('COMMITTED', 'CANCELLED') NOT NULL DEFAULT 'COMMITTED',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `committed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `cancelled_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bank_statement_imports_public_id_key` (`public_id`),
  UNIQUE INDEX `bank_statement_imports_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `bank_statement_imports_company_account_hash_key` (`company_id`, `cash_bank_account_id`, `source_hash_sha256`),
  INDEX `bank_statement_imports_company_id_status_committed_at_idx` (`company_id`, `status`, `committed_at`),
  INDEX `bank_statement_imports_created_by_id_created_at_idx` (`created_by_id`, `created_at`),
  CONSTRAINT `bank_statement_imports_period_chk` CHECK (`period_start` <= `period_end`),
  CONSTRAINT `bank_statement_imports_line_count_chk` CHECK (`line_count` > 0 AND `line_count` <= 5000),
  CONSTRAINT `bank_statement_imports_cancelled_chk` CHECK ((`status` = 'CANCELLED' AND `cancelled_at` IS NOT NULL) OR (`status` = 'COMMITTED' AND `cancelled_at` IS NULL)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bank_statement_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `statement_import_id` BIGINT UNSIGNED NOT NULL,
  `source_row_number` SMALLINT UNSIGNED NOT NULL,
  `booking_date` DATE NOT NULL,
  `value_date` DATE NULL,
  `amount` DECIMAL(19, 4) NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `fingerprint_sha256` BINARY(32) NOT NULL,
  `external_id` VARCHAR(160) NULL,
  `reference` VARCHAR(160) NULL,
  `description` VARCHAR(500) NULL,
  `classification` ENUM('PENDING_TRANSACTION', 'BANK_FEE', 'BANK_INTEREST', 'BANK_ERROR', 'NEEDS_ACCOUNTING_DOCUMENT') NULL,
  `classification_note` VARCHAR(500) NULL,
  `classified_by_id` BIGINT UNSIGNED NULL,
  `classified_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `bank_statement_lines_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `bank_statement_lines_statement_import_id_source_row_number_key` (`statement_import_id`, `source_row_number`),
  INDEX `bank_statement_lines_company_id_booking_date_id_idx` (`company_id`, `booking_date`, `id`),
  INDEX `bank_statement_lines_company_id_fingerprint_sha256_idx` (`company_id`, `fingerprint_sha256`),
  INDEX `bank_statement_lines_classified_by_id_classified_at_idx` (`classified_by_id`, `classified_at`),
  CONSTRAINT `bank_statement_lines_amount_nonzero_chk` CHECK (`amount` <> 0),
  CONSTRAINT `bank_statement_lines_classification_chk` CHECK ((`classification` IS NULL AND `classification_note` IS NULL AND `classified_by_id` IS NULL AND `classified_at` IS NULL) OR (`classification` IS NOT NULL AND `classification_note` IS NOT NULL AND `classified_by_id` IS NOT NULL AND `classified_at` IS NOT NULL)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bank_reconciliation_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `cash_bank_account_id` BIGINT UNSIGNED NOT NULL,
  `statement_import_id` BIGINT UNSIGNED NOT NULL,
  `date_from` DATE NOT NULL,
  `date_to` DATE NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `bank_opening_balance` DECIMAL(19, 4) NULL,
  `bank_closing_balance` DECIMAL(19, 4) NULL,
  `bank_net_movement` DECIMAL(19, 4) NOT NULL,
  `book_opening_balance` DECIMAL(19, 4) NOT NULL,
  `book_closing_balance` DECIMAL(19, 4) NOT NULL,
  `book_net_movement` DECIMAL(19, 4) NOT NULL,
  `difference` DECIMAL(19, 4) NOT NULL,
  `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `closed_by_id` BIGINT UNSIGNED NULL,
  `closed_at` DATETIME(3) NULL,
  `closing_explanation` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bank_reconciliation_sessions_public_id_key` (`public_id`),
  UNIQUE INDEX `bank_reconciliation_sessions_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `bank_reconciliation_sessions_statement_import_id_company_id_key` (`statement_import_id`, `company_id`),
  INDEX `bank_reconciliation_sessions_company_account_status_dates_idx` (`company_id`, `cash_bank_account_id`, `status`, `date_from`, `date_to`),
  INDEX `bank_reconciliation_sessions_created_by_id_created_at_idx` (`created_by_id`, `created_at`),
  INDEX `bank_reconciliation_sessions_closed_by_id_closed_at_idx` (`closed_by_id`, `closed_at`),
  CONSTRAINT `bank_reconciliation_sessions_period_chk` CHECK (`date_from` <= `date_to`),
  CONSTRAINT `bank_reconciliation_sessions_close_chk` CHECK ((`status` = 'OPEN' AND `closed_by_id` IS NULL AND `closed_at` IS NULL AND `closing_explanation` IS NULL) OR (`status` = 'CLOSED' AND `closed_by_id` IS NOT NULL AND `closed_at` IS NOT NULL)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `bank_reconciliation_matches` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `bank_statement_line_id` BIGINT UNSIGNED NOT NULL,
  `book_movement_key` VARCHAR(120) NOT NULL,
  `book_movement_date` DATE NOT NULL,
  `book_amount` DECIMAL(19, 4) NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `book_reference` VARCHAR(160) NULL,
  `book_document_type` VARCHAR(40) NOT NULL,
  `book_document_number` VARCHAR(60) NOT NULL,
  `status` ENUM('PROPOSED', 'APPROVED', 'RELEASED') NOT NULL DEFAULT 'PROPOSED',
  `source` ENUM('SUGGESTED', 'MANUAL') NOT NULL,
  `rule` ENUM('EXACT_REFERENCE_AMOUNT_CURRENCY', 'EXACT_AMOUNT_CURRENCY_DATE', 'MANUAL') NOT NULL,
  `score` TINYINT UNSIGNED NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `active_bank_statement_line_id` BIGINT UNSIGNED NULL,
  `active_book_movement_key` VARCHAR(120) NULL,
  `approved_by_id` BIGINT UNSIGNED NULL,
  `approved_at` DATETIME(3) NULL,
  `released_by_id` BIGINT UNSIGNED NULL,
  `released_at` DATETIME(3) NULL,
  `release_reason` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `bank_reconciliation_matches_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `bank_reconciliation_matches_company_active_line_key` (`company_id`, `active_bank_statement_line_id`),
  UNIQUE INDEX `bank_reconciliation_matches_company_active_book_key` (`company_id`, `active_book_movement_key`),
  INDEX `bank_reconciliation_matches_company_session_status_id_idx` (`company_id`, `session_id`, `status`, `id`),
  INDEX `bank_reconciliation_matches_company_book_movement_key_idx` (`company_id`, `book_movement_key`),
  INDEX `bank_reconciliation_matches_approved_by_id_approved_at_idx` (`approved_by_id`, `approved_at`),
  INDEX `bank_reconciliation_matches_released_by_id_released_at_idx` (`released_by_id`, `released_at`),
  CONSTRAINT `bank_reconciliation_matches_amount_nonzero_chk` CHECK (`book_amount` <> 0),
  CONSTRAINT `bank_reconciliation_matches_score_chk` CHECK (`score` <= 100),
  CONSTRAINT `bank_reconciliation_matches_active_chk` CHECK ((`status` = 'APPROVED' AND `active_bank_statement_line_id` = `bank_statement_line_id` AND `active_book_movement_key` = `book_movement_key` AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND `released_by_id` IS NULL AND `released_at` IS NULL AND `release_reason` IS NULL) OR (`status` = 'PROPOSED' AND `active_bank_statement_line_id` IS NULL AND `active_book_movement_key` IS NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `released_by_id` IS NULL AND `released_at` IS NULL AND `release_reason` IS NULL) OR (`status` = 'RELEASED' AND `active_bank_statement_line_id` IS NULL AND `active_book_movement_key` IS NULL AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND `released_by_id` IS NOT NULL AND `released_at` IS NOT NULL AND `release_reason` IS NOT NULL)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `bank_statement_imports`
  ADD CONSTRAINT `bank_statement_imports_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_statement_imports_cash_bank_account_company_fkey` FOREIGN KEY (`cash_bank_account_id`, `company_id`) REFERENCES `cash_bank_accounts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_statement_imports_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `bank_statement_lines`
  ADD CONSTRAINT `bank_statement_lines_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_statement_lines_import_company_fkey` FOREIGN KEY (`statement_import_id`, `company_id`) REFERENCES `bank_statement_imports` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_statement_lines_classified_by_id_fkey` FOREIGN KEY (`classified_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `bank_reconciliation_sessions`
  ADD CONSTRAINT `bank_reconciliation_sessions_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_sessions_cash_account_company_fkey` FOREIGN KEY (`cash_bank_account_id`, `company_id`) REFERENCES `cash_bank_accounts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_sessions_import_company_fkey` FOREIGN KEY (`statement_import_id`, `company_id`) REFERENCES `bank_statement_imports` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_sessions_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_sessions_closed_by_id_fkey` FOREIGN KEY (`closed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `bank_reconciliation_matches`
  ADD CONSTRAINT `bank_reconciliation_matches_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_matches_session_company_fkey` FOREIGN KEY (`session_id`, `company_id`) REFERENCES `bank_reconciliation_sessions` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_matches_line_company_fkey` FOREIGN KEY (`bank_statement_line_id`, `company_id`) REFERENCES `bank_statement_lines` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_matches_approved_by_id_fkey` FOREIGN KEY (`approved_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `bank_reconciliation_matches_released_by_id_fkey` FOREIGN KEY (`released_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('bank_reconciliation.view', 'bank_reconciliation', 'عرض استيرادات وجلسات المطابقة البنكية'),
  ('bank_reconciliation.import', 'bank_reconciliation', 'معاينة واعتماد استيراد كشوف البنك'),
  ('bank_reconciliation.review', 'bank_reconciliation', 'مراجعة واعتماد وفك وتصنيف المطابقات البنكية'),
  ('bank_reconciliation.close', 'bank_reconciliation', 'إقفال جلسات المطابقة البنكية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'bank_reconciliation.view',
  'bank_reconciliation.import',
  'bank_reconciliation.review',
  'bank_reconciliation.close'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
