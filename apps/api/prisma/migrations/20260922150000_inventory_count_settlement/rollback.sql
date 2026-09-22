ALTER TABLE `stock_count_sessions`
  DROP CONSTRAINT `stock_count_sessions_state_chk`,
  DROP FOREIGN KEY `stock_count_sessions_settled_by_fk`,
  DROP FOREIGN KEY `stock_count_sessions_shortage_movement_company_fk`,
  DROP FOREIGN KEY `stock_count_sessions_surplus_movement_company_fk`,
  DROP INDEX `stock_count_sessions_shortage_movement_company_key`,
  DROP INDEX `stock_count_sessions_surplus_movement_company_key`,
  DROP COLUMN `settled_at`,
  DROP COLUMN `settled_by_id`,
  DROP COLUMN `shortage_movement_id`,
  DROP COLUMN `surplus_movement_id`,
  DROP COLUMN `settlement_date`,
  MODIFY COLUMN `status` ENUM('DRAFT','SUBMITTED','APPROVED') NOT NULL DEFAULT 'DRAFT',
  ADD CONSTRAINT `stock_count_sessions_state_chk` CHECK (
    (`status` = 'DRAFT' AND `submitted_by_id` IS NULL AND `submitted_at` IS NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL)
    OR (`status` = 'SUBMITTED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NULL AND `approved_at` IS NULL AND `approved_by_name` IS NULL)
    OR (`status` = 'APPROVED' AND `submitted_by_id` IS NOT NULL AND `submitted_at` IS NOT NULL AND `approved_by_id` IS NOT NULL AND `approved_at` IS NOT NULL AND CHAR_LENGTH(TRIM(`approved_by_name`)) > 0)
  );
