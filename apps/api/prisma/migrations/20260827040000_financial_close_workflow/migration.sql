CREATE TABLE `financial_close_runs` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `fiscal_period_id` BIGINT UNSIGNED NOT NULL,
  `cycle` SMALLINT UNSIGNED NOT NULL,
  `status` ENUM('PREPARING', 'REVIEWED', 'CLOSED') NOT NULL DEFAULT 'PREPARING',
  `checklist_snapshot` JSON NOT NULL,
  `checklist_hash_sha256` BINARY(32) NOT NULL,
  `close_pack_snapshot` JSON NULL,
  `close_pack_hash_sha256` BINARY(32) NULL,
  `close_document_id` BIGINT UNSIGNED NULL,
  `started_by_id` BIGINT UNSIGNED NOT NULL,
  `reviewed_by_id` BIGINT UNSIGNED NULL,
  `reviewed_at` DATETIME(3) NULL,
  `returned_by_id` BIGINT UNSIGNED NULL,
  `returned_at` DATETIME(3) NULL,
  `return_reason` VARCHAR(500) NULL,
  `closed_by_id` BIGINT UNSIGNED NULL,
  `closed_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `financial_close_runs_public_id_key` (`public_id`),
  UNIQUE INDEX `financial_close_runs_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `financial_close_runs_fiscal_period_id_cycle_key` (`fiscal_period_id`, `cycle`),
  UNIQUE INDEX `financial_close_runs_close_document_id_company_id_key` (`close_document_id`, `company_id`),
  INDEX `financial_close_runs_company_id_status_created_at_idx` (`company_id`, `status`, `created_at`),
  INDEX `financial_close_runs_started_by_id_created_at_idx` (`started_by_id`, `created_at`),
  INDEX `financial_close_runs_reviewed_by_id_reviewed_at_idx` (`reviewed_by_id`, `reviewed_at`),
  INDEX `financial_close_runs_returned_by_id_returned_at_idx` (`returned_by_id`, `returned_at`),
  INDEX `financial_close_runs_closed_by_id_closed_at_idx` (`closed_by_id`, `closed_at`),
  CONSTRAINT `financial_close_runs_reviewed_chk` CHECK ((`status` = 'PREPARING') OR (`reviewed_by_id` IS NOT NULL AND `reviewed_at` IS NOT NULL)),
  CONSTRAINT `financial_close_runs_closed_chk` CHECK ((`status` <> 'CLOSED' AND `closed_by_id` IS NULL AND `closed_at` IS NULL) OR (`status` = 'CLOSED' AND `closed_by_id` IS NOT NULL AND `closed_at` IS NOT NULL)),
  CONSTRAINT `financial_close_runs_return_chk` CHECK ((`returned_by_id` IS NULL AND `returned_at` IS NULL AND `return_reason` IS NULL) OR (`returned_by_id` IS NOT NULL AND `returned_at` IS NOT NULL AND `return_reason` IS NOT NULL)),
  CONSTRAINT `financial_close_runs_pack_chk` CHECK ((`close_pack_snapshot` IS NULL AND `close_pack_hash_sha256` IS NULL) OR (`close_pack_snapshot` IS NOT NULL AND `close_pack_hash_sha256` IS NOT NULL)),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `financial_close_runs`
  ADD CONSTRAINT `financial_close_runs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `financial_close_runs_period_company_fkey` FOREIGN KEY (`fiscal_period_id`, `company_id`) REFERENCES `fiscal_periods` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `financial_close_runs_started_by_id_fkey` FOREIGN KEY (`started_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `financial_close_runs_reviewed_by_id_fkey` FOREIGN KEY (`reviewed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `financial_close_runs_returned_by_id_fkey` FOREIGN KEY (`returned_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `financial_close_runs_closed_by_id_fkey` FOREIGN KEY (`closed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
  
ALTER TABLE `financial_close_runs`
  ADD CONSTRAINT `financial_close_runs_close_document_company_fkey` FOREIGN KEY (`close_document_id`, `company_id`) REFERENCES `accounting_documents` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
