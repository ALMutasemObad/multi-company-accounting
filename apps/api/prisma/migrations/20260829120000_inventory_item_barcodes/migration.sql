-- Inventory-owned barcode identity foundation (B1). Barcode rendering, label printing,
-- GS1 application identifiers, lots and serials are deliberately outside this slice.
CREATE TABLE `inventory_item_barcodes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `inventory_item_id` BIGINT UNSIGNED NOT NULL,
  `symbology` ENUM('EAN_13', 'EAN_8', 'UPC_A', 'CODE_128', 'QR') NOT NULL,
  `value` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `normalized_value` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT FALSE,
  `primary_inventory_item_id` BIGINT UNSIGNED NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `inventory_barcodes_id_company_key` (`id`, `company_id`),
  UNIQUE INDEX `inventory_barcodes_company_normalized_key` (`company_id`, `normalized_value`),
  UNIQUE INDEX `inventory_barcodes_company_primary_item_key` (`company_id`, `primary_inventory_item_id`),
  INDEX `inventory_barcodes_company_item_id_idx` (`company_id`, `inventory_item_id`, `id`),
  INDEX `inventory_barcodes_company_item_active_id_idx` (`company_id`, `inventory_item_id`, `is_active`, `id`),
  CONSTRAINT `inventory_item_barcodes_value_nonempty_chk`
    CHECK (CHAR_LENGTH(`value`) > 0 AND CHAR_LENGTH(`normalized_value`) > 0),
  CONSTRAINT `inventory_item_barcodes_primary_state_chk`
    CHECK (
      (`is_primary` = TRUE AND `is_active` = TRUE AND `primary_inventory_item_id` = `inventory_item_id`)
      OR
      (`is_primary` = FALSE AND `primary_inventory_item_id` IS NULL)
    ),
  CONSTRAINT `inventory_item_barcodes_company_id_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `inventory_item_barcodes_inventory_item_id_company_id_fkey`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- There is no legacy barcode column to backfill. Existing items intentionally start
-- without an inferred identifier: manufacturing a barcode would create false identity.

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('inventory_barcodes.view', 'inventory', 'عرض باركودات الأصناف'),
  ('inventory_barcodes.manage', 'inventory', 'إدارة باركودات الأصناف'),
  ('inventory_barcodes.resolve', 'inventory', 'التعرف على الأصناف بواسطة الباركود')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'inventory_barcodes.view',
  'inventory_barcodes.manage',
  'inventory_barcodes.resolve'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
