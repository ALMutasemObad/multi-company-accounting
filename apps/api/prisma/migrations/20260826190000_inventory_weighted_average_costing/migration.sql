ALTER TABLE `inventory_movement_lines`
  ADD COLUMN `unit_cost_base` DECIMAL(19,8) NULL AFTER `quantity`,
  ADD COLUMN `total_cost_base` DECIMAL(19,4) NULL AFTER `unit_cost_base`,
  ADD COLUMN `is_cost_initialized` BOOLEAN NOT NULL DEFAULT FALSE AFTER `total_cost_base`;

UPDATE `inventory_movement_lines`
SET `unit_cost_base` = 0.00000000,
    `total_cost_base` = 0.0000
WHERE `unit_cost_base` IS NULL OR `total_cost_base` IS NULL;

ALTER TABLE `inventory_movement_lines`
  MODIFY `unit_cost_base` DECIMAL(19,8) NOT NULL DEFAULT 0.00000000,
  MODIFY `total_cost_base` DECIMAL(19,4) NOT NULL DEFAULT 0.0000,
  MODIFY `is_cost_initialized` BOOLEAN NOT NULL DEFAULT FALSE,
  ADD CONSTRAINT `inventory_movement_lines_unit_cost_nonnegative_chk`
    CHECK (`unit_cost_base` >= 0),
  ADD CONSTRAINT `inventory_movement_lines_total_cost_nonnegative_chk`
    CHECK (`total_cost_base` >= 0);

ALTER TABLE `inventory_balances`
  ADD COLUMN `inventory_value_base` DECIMAL(19,4) NOT NULL DEFAULT 0.0000 AFTER `on_hand`,
  ADD COLUMN `average_unit_cost_base` DECIMAL(19,8) NOT NULL DEFAULT 0.00000000 AFTER `inventory_value_base`,
  ADD COLUMN `is_valuation_initialized` BOOLEAN NOT NULL DEFAULT FALSE AFTER `average_unit_cost_base`,
  ADD CONSTRAINT `inventory_balances_value_nonnegative_chk`
    CHECK (`inventory_value_base` >= 0),
  ADD CONSTRAINT `inventory_balances_average_cost_nonnegative_chk`
    CHECK (`average_unit_cost_base` >= 0);

UPDATE `inventory_balances`
SET `is_valuation_initialized` = TRUE
WHERE `on_hand` = 0;

CREATE TABLE `inventory_valuation_initializations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `inventory_balance_id` BIGINT UNSIGNED NOT NULL,
  `quantity_snapshot` DECIMAL(19,6) NOT NULL,
  `unit_cost_base` DECIMAL(19,8) NOT NULL,
  `total_value_base` DECIMAL(19,4) NOT NULL,
  `reason` VARCHAR(500) NOT NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `inventory_valuation_initializations_balance_company_key` (`inventory_balance_id`, `company_id`),
  UNIQUE KEY `inventory_valuation_initializations_id_company_key` (`id`, `company_id`),
  KEY `inventory_valuation_initializations_company_created_idx` (`company_id`, `created_at`),
  KEY `inventory_valuation_initializations_created_by_idx` (`created_by_id`),
  CONSTRAINT `inventory_valuation_initializations_company_fk`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_valuation_initializations_balance_company_fk`
    FOREIGN KEY (`inventory_balance_id`, `company_id`)
    REFERENCES `inventory_balances` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_valuation_initializations_created_by_fk`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_valuation_initializations_unit_cost_nonnegative_chk`
    CHECK (`unit_cost_base` >= 0),
  CONSTRAINT `inventory_valuation_initializations_total_value_nonnegative_chk`
    CHECK (`total_value_base` >= 0),
  CONSTRAINT `inventory_valuation_initializations_reason_chk`
    CHECK (CHAR_LENGTH(TRIM(`reason`)) BETWEEN 3 AND 500)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
