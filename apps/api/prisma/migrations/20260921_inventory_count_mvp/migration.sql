CREATE TABLE `stock_count_sessions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `count_date` DATE NOT NULL,
  `snapshot_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `status` ENUM('DRAFT', 'SUBMITTED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
  `last_receipt_movement_id` BIGINT UNSIGNED NULL,
  `last_receipt_movement_number` VARCHAR(40) NULL,
  `last_issue_movement_id` BIGINT UNSIGNED NULL,
  `last_issue_movement_number` VARCHAR(40) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `submitted_by_id` BIGINT UNSIGNED NULL,
  `submitted_at` DATETIME(3) NULL,
  `approved_by_id` BIGINT UNSIGNED NULL,
  `approved_by_name` VARCHAR(160) NULL,
  `approved_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `stock_count_sessions_id_company_key` (`id`, `company_id`),
  INDEX `stock_count_sessions_company_warehouse_date_id_idx` (`company_id`, `warehouse_id`, `count_date`, `id`),
  INDEX `stock_count_sessions_company_status_date_id_idx` (`company_id`, `status`, `count_date`, `id`),
  CONSTRAINT `stock_count_sessions_cutoff_pairs_chk` CHECK (
    (`last_receipt_movement_id` IS NULL) = (`last_receipt_movement_number` IS NULL)
    AND (`last_issue_movement_id` IS NULL) = (`last_issue_movement_number` IS NULL)
  ),
  CONSTRAINT `stock_count_sessions_state_chk` CHECK (
    (`status` = 'DRAFT' AND `submitted_by_id` IS NULL AND `submitted_at` IS NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL)
    OR (`status` = 'SUBMITTED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL)
    OR (`status` = 'APPROVED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND CHAR_LENGTH(TRIM(`approved_by_name`)) > 0)
  ),
  CONSTRAINT `stock_count_sessions_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_warehouse_company_fk` FOREIGN KEY (`warehouse_id`, `company_id`) REFERENCES `warehouses` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_receipt_company_fk` FOREIGN KEY (`last_receipt_movement_id`, `company_id`) REFERENCES `inventory_movements` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_issue_company_fk` FOREIGN KEY (`last_issue_movement_id`, `company_id`) REFERENCES `inventory_movements` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_created_by_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_submitted_by_fk` FOREIGN KEY (`submitted_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_sessions_approved_by_fk` FOREIGN KEY (`approved_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_count_committee_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `member_name` VARCHAR(160) NOT NULL,
  `member_role` VARCHAR(120) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `stock_count_members_company_session_name_role_key` (`company_id`, `session_id`, `member_name`, `member_role`),
  INDEX `stock_count_members_company_session_id_idx` (`company_id`, `session_id`, `id`),
  CONSTRAINT `stock_count_members_text_chk` CHECK (CHAR_LENGTH(TRIM(`member_name`)) > 0 AND CHAR_LENGTH(TRIM(`member_role`)) > 0),
  CONSTRAINT `stock_count_members_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_members_session_company_fk` FOREIGN KEY (`session_id`, `company_id`) REFERENCES `stock_count_sessions` (`id`, `company_id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `stock_count_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `session_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `item_code_snapshot` VARCHAR(40) NOT NULL,
  `item_title_snapshot` VARCHAR(200) NOT NULL,
  `unit_code_snapshot` VARCHAR(20) NOT NULL,
  `location_snapshot` VARCHAR(300) NULL,
  `shelf_snapshot` VARCHAR(120) NULL,
  `book_quantity` DECIMAL(19,6) NOT NULL,
  `book_unit_cost_base` DECIMAL(19,8) NOT NULL,
  `book_value_base` DECIMAL(19,4) NOT NULL,
  `is_valuation_initialized` BOOLEAN NOT NULL DEFAULT false,
  `counted_quantity` DECIMAL(19,6) NULL,
  `variance_quantity` DECIMAL(19,6) NULL,
  `variance_reason` VARCHAR(500) NULL,
  `counted_by_id` BIGINT UNSIGNED NULL,
  `counted_by_name_snapshot` VARCHAR(160) NULL,
  `counted_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `stock_count_lines_company_session_item_key` (`company_id`, `session_id`, `inventory_item_id`),
  UNIQUE INDEX `stock_count_lines_id_company_key` (`id`, `company_id`),
  INDEX `stock_count_lines_company_session_code_idx` (`company_id`, `session_id`, `item_code_snapshot`),
  INDEX `stock_count_lines_company_session_title_idx` (`company_id`, `session_id`, `item_title_snapshot`),
  CONSTRAINT `stock_count_lines_count_shape_chk` CHECK (
    (`counted_quantity` IS NULL AND `variance_quantity` IS NULL AND `counted_by_id` IS NULL AND `counted_by_name_snapshot` IS NULL AND `counted_at` IS NULL)
    OR (`counted_quantity` >= 0 AND `variance_quantity` = `counted_quantity` - `book_quantity` AND `counted_by_id` IS NOT NULL AND CHAR_LENGTH(TRIM(`counted_by_name_snapshot`)) > 0 AND `counted_at` IS NOT NULL)
  ),
  CONSTRAINT `stock_count_lines_variance_reason_chk` CHECK (`variance_quantity` IS NULL OR `variance_quantity` = 0 OR CHAR_LENGTH(TRIM(`variance_reason`)) > 0),
  CONSTRAINT `stock_count_lines_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_lines_session_company_fk` FOREIGN KEY (`session_id`, `company_id`) REFERENCES `stock_count_sessions` (`id`, `company_id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_lines_item_company_fk` FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `stock_count_lines_counted_by_fk` FOREIGN KEY (`counted_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
