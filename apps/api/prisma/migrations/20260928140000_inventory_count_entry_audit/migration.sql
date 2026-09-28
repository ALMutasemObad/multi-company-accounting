ALTER TABLE `stock_count_entries`
  ADD COLUMN `note` VARCHAR(500) NULL,
  ADD COLUMN `entry_kind` VARCHAR(24) NOT NULL DEFAULT 'BATCH',
  ADD COLUMN `reversed_at` DATETIME(3) NULL,
  ADD COLUMN `reversed_by_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `reversal_reason` VARCHAR(500) NULL;

CREATE INDEX `stock_count_entries_company_session_kind_created_idx`
  ON `stock_count_entries`(`company_id`, `session_id`, `entry_kind`, `created_at`);

CREATE INDEX `stock_count_entries_reversed_by_id_idx`
  ON `stock_count_entries`(`reversed_by_id`);

ALTER TABLE `stock_count_entries`
  ADD CONSTRAINT `stock_count_entries_reversed_by_id_fkey`
  FOREIGN KEY (`reversed_by_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
