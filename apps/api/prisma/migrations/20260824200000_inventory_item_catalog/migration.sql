-- Second Inventory bounded-context slice: units of measure and item catalog.
CREATE TABLE `units_of_measure` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(20) NOT NULL,
  `name_ar` VARCHAR(120) NOT NULL,
  `name_en` VARCHAR(120) NULL,
  `decimal_places` TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `units_of_measure_company_id_code_key` (`company_id`, `code`),
  UNIQUE INDEX `units_of_measure_id_company_id_key` (`id`, `company_id`),
  INDEX `units_of_measure_company_id_is_active_name_ar_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `units_of_measure_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `inventory_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `unit_of_measure_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `description` VARCHAR(500) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_items_company_id_code_key` (`company_id`, `code`),
  UNIQUE INDEX `inventory_items_id_company_id_key` (`id`, `company_id`),
  INDEX `inventory_items_company_id_unit_of_measure_id_is_active_idx` (`company_id`, `unit_of_measure_id`, `is_active`),
  INDEX `inventory_items_company_id_is_active_name_ar_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `inventory_items_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_items_unit_of_measure_id_company_id_fkey`
    FOREIGN KEY (`unit_of_measure_id`, `company_id`) REFERENCES `units_of_measure`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences` (
  `company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`
)
SELECT `companies`.`id`, 'INVENTORY_ITEM', 'ITM-', 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
ON DUPLICATE KEY UPDATE
  `prefix` = VALUES(`prefix`),
  `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('inventory_catalog.view', 'inventory', 'عرض وحدات القياس وكتالوج الأصناف'),
  ('inventory_catalog.manage', 'inventory', 'إدارة وحدات القياس وكتالوج الأصناف')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('inventory_catalog.view', 'inventory_catalog.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = true;
