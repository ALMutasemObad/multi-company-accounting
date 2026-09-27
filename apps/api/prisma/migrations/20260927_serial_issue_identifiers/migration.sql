ALTER TABLE `inventory_items`
  ADD COLUMN `publication_identifier` VARCHAR(40) NULL,
  ADD COLUMN `issue_number` VARCHAR(40) NULL,
  ADD COLUMN `import_source_key` VARCHAR(120) NULL;

CREATE INDEX `inventory_items_company_publication_identifier_idx`
  ON `inventory_items`(`company_id`, `publication_identifier`);

CREATE UNIQUE INDEX `inventory_items_company_import_source_key_key`
  ON `inventory_items`(`company_id`, `import_source_key`);

CREATE TABLE `inventory_barcode_settings` (
  `company_id` BIGINT UNSIGNED NOT NULL,
  `label_size` VARCHAR(10) NOT NULL DEFAULT '50x25',
  `default_symbology` ENUM('EAN_13','EAN_8','UPC_A','CODE_128','QR') NOT NULL DEFAULT 'CODE_128',
  `show_item_name` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_publication_year` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_issue_number` BOOLEAN NOT NULL DEFAULT FALSE,
  `show_barcode_text` BOOLEAN NOT NULL DEFAULT TRUE,
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`company_id`),
  CONSTRAINT `inventory_barcode_settings_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
);
