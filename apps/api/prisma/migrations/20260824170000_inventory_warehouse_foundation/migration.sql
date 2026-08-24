-- First Inventory bounded-context slice: company-scoped warehouse master data.
CREATE TABLE `warehouses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(160) NOT NULL,
  `name_en` VARCHAR(160) NULL,
  `address` VARCHAR(300) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `warehouses_company_id_code_key` (`company_id`, `code`),
  UNIQUE INDEX `warehouses_id_company_id_key` (`id`, `company_id`),
  INDEX `warehouses_company_id_is_active_name_ar_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `warehouses_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences` (
  `company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`
)
SELECT `companies`.`id`, 'WAREHOUSE', 'WH-', 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
ON DUPLICATE KEY UPDATE
  `prefix` = VALUES(`prefix`),
  `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('warehouses.view', 'inventory', 'عرض المستودعات'),
  ('warehouses.manage', 'inventory', 'إدارة المستودعات')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('warehouses.view', 'warehouses.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = true;
