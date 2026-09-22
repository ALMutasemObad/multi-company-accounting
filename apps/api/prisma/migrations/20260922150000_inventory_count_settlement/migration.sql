ALTER TABLE `stock_count_sessions`
  DROP CONSTRAINT `stock_count_sessions_state_chk`,
  MODIFY COLUMN `status` ENUM('DRAFT','SUBMITTED','APPROVED','SETTLED') NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN `settlement_date` DATE NULL,
  ADD COLUMN `surplus_movement_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `shortage_movement_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `settled_by_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `settled_at` DATETIME(3) NULL,
  ADD UNIQUE INDEX `stock_count_sessions_surplus_movement_company_key` (`surplus_movement_id`, `company_id`),
  ADD UNIQUE INDEX `stock_count_sessions_shortage_movement_company_key` (`shortage_movement_id`, `company_id`),
  ADD CONSTRAINT `stock_count_sessions_surplus_movement_company_fk`
    FOREIGN KEY (`surplus_movement_id`, `company_id`) REFERENCES `inventory_movements` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stock_count_sessions_shortage_movement_company_fk`
    FOREIGN KEY (`shortage_movement_id`, `company_id`) REFERENCES `inventory_movements` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stock_count_sessions_settled_by_fk`
    FOREIGN KEY (`settled_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `stock_count_sessions_state_chk` CHECK (
    (`status` = 'DRAFT' AND `submitted_by_id` IS NULL AND `submitted_at` IS NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL AND `settled_by_id` IS NULL AND `settled_at` IS NULL AND `settlement_date` IS NULL AND `surplus_movement_id` IS NULL AND `shortage_movement_id` IS NULL)
    OR (`status` = 'SUBMITTED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL AND `settled_by_id` IS NULL AND `settled_at` IS NULL AND `settlement_date` IS NULL AND `surplus_movement_id` IS NULL AND `shortage_movement_id` IS NULL)
    OR (`status` = 'APPROVED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND CHAR_LENGTH(TRIM(`approved_by_name`)) > 0 AND `settled_by_id` IS NULL AND `settled_at` IS NULL AND `settlement_date` IS NULL AND `surplus_movement_id` IS NULL AND `shortage_movement_id` IS NULL)
    OR (`status` = 'SETTLED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND CHAR_LENGTH(TRIM(`approved_by_name`)) > 0 AND `settled_by_id` IS NOT NULL AND `settled_at` IS NOT NULL AND `settlement_date` IS NOT NULL)
  );
