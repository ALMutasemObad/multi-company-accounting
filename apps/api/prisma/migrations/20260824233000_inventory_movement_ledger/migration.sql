-- Inventory quantity ledger. Movements are immutable; balances are a locked,
-- company-scoped projection updated in the same transaction.
CREATE TABLE `inventory_movement_sequences` (
  `company_id` BIGINT UNSIGNED NOT NULL,
  `prefix` VARCHAR(12) NOT NULL DEFAULT 'IMV-',
  `next_number` BIGINT UNSIGNED NOT NULL DEFAULT 1,
  `padding` TINYINT UNSIGNED NOT NULL DEFAULT 8,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`company_id`),
  CONSTRAINT `inventory_movement_sequences_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_movements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `movement_number` VARCHAR(40) NOT NULL,
  `movement_type` ENUM('OPENING_BALANCE', 'RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT') NOT NULL,
  `movement_date` DATE NOT NULL,
  `description` VARCHAR(500) NOT NULL,
  `external_reference` VARCHAR(100) NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_movements_company_id_movement_number_key` (`company_id`, `movement_number`),
  UNIQUE INDEX `inventory_movements_id_company_id_key` (`id`, `company_id`),
  INDEX `inventory_movements_company_id_movement_date_id_idx` (`company_id`, `movement_date`, `id`),
  INDEX `inventory_movements_company_id_movement_type_movement_date_idx` (`company_id`, `movement_type`, `movement_date`),
  INDEX `inventory_movements_company_id_external_reference_idx` (`company_id`, `external_reference`),
  CONSTRAINT `inventory_movements_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_movements_created_by_id_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_movement_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `movement_id` BIGINT UNSIGNED NOT NULL,
  `line_number` SMALLINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `from_warehouse_id` BIGINT UNSIGNED NULL,
  `to_warehouse_id` BIGINT UNSIGNED NULL,
  `quantity` DECIMAL(19, 6) NOT NULL,
  `inventory_item_code_snapshot` VARCHAR(40) NOT NULL,
  `inventory_item_name_snapshot` VARCHAR(200) NOT NULL,
  `unit_of_measure_code_snapshot` VARCHAR(20) NOT NULL,
  `from_warehouse_code_snapshot` VARCHAR(40) NULL,
  `from_warehouse_name_snapshot` VARCHAR(160) NULL,
  `to_warehouse_code_snapshot` VARCHAR(40) NULL,
  `to_warehouse_name_snapshot` VARCHAR(160) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_movement_lines_movement_id_line_number_key` (`movement_id`, `line_number`),
  INDEX `inventory_movement_lines_company_id_inventory_item_id_idx` (`company_id`, `inventory_item_id`),
  INDEX `inventory_movement_lines_company_id_from_warehouse_id_idx` (`company_id`, `from_warehouse_id`),
  INDEX `inventory_movement_lines_company_id_to_warehouse_id_idx` (`company_id`, `to_warehouse_id`),
  CONSTRAINT `inventory_movement_lines_quantity_positive_chk` CHECK (`quantity` > 0),
  CONSTRAINT `inventory_movement_lines_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_movement_lines_movement_id_company_id_fkey`
    FOREIGN KEY (`movement_id`, `company_id`) REFERENCES `inventory_movements`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_movement_lines_inventory_item_id_company_id_fkey`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_movement_lines_from_warehouse_id_company_id_fkey`
    FOREIGN KEY (`from_warehouse_id`, `company_id`) REFERENCES `warehouses`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_movement_lines_to_warehouse_id_company_id_fkey`
    FOREIGN KEY (`to_warehouse_id`, `company_id`) REFERENCES `warehouses`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_balances` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `warehouse_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `on_hand` DECIMAL(19, 6) NOT NULL DEFAULT 0,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `movement_count` INT UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_balances_company_id_warehouse_id_inventory_item_id_key` (`company_id`, `warehouse_id`, `inventory_item_id`),
  UNIQUE INDEX `inventory_balances_id_company_id_key` (`id`, `company_id`),
  INDEX `inventory_balances_company_id_inventory_item_id_warehouse_id_idx` (`company_id`, `inventory_item_id`, `warehouse_id`),
  CONSTRAINT `inventory_balances_on_hand_nonnegative_chk` CHECK (`on_hand` >= 0),
  CONSTRAINT `inventory_balances_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_balances_warehouse_id_company_id_fkey`
    FOREIGN KEY (`warehouse_id`, `company_id`) REFERENCES `warehouses`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_balances_inventory_item_id_company_id_fkey`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `inventory_movement_sequences` (`company_id`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'IMV-', 1, 8, CURRENT_TIMESTAMP(3)
FROM `companies`
ON DUPLICATE KEY UPDATE `prefix` = VALUES(`prefix`), `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('inventory_movements.view', 'inventory', 'عرض أرصدة وحركات المخزون'),
  ('inventory_movements.create', 'inventory', 'إنشاء حركات المخزون')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('inventory_movements.view', 'inventory_movements.create')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = true;
