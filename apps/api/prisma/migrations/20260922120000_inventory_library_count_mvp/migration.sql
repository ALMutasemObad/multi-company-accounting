ALTER TABLE `inventory_items`
  ADD COLUMN `author` VARCHAR(200) NULL,
  ADD COLUMN `publisher` VARCHAR(200) NULL,
  ADD COLUMN `publication_year` SMALLINT UNSIGNED NULL,
  ADD COLUMN `edition` VARCHAR(120) NULL;

CREATE TABLE `stock_count_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `line_id` BIGINT UNSIGNED NOT NULL,
  `entry_key` VARCHAR(100) NOT NULL,
  `quantity` DECIMAL(19,6) NOT NULL,
  `location_reference` VARCHAR(200) NULL,
  `counter_name_snapshot` VARCHAR(160) NOT NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `stock_count_entries_company_key` (`company_id`, `entry_key`),
  KEY `stock_count_entries_session_created_idx` (`company_id`, `session_id`, `created_at`),
  KEY `stock_count_entries_line_created_idx` (`company_id`, `line_id`, `created_at`),
  CONSTRAINT `stock_count_entries_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_entries_session_company_fk` FOREIGN KEY (`session_id`, `company_id`) REFERENCES `stock_count_sessions` (`id`, `company_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_entries_line_company_fk` FOREIGN KEY (`line_id`, `company_id`) REFERENCES `stock_count_lines` (`id`, `company_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_entries_created_by_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
