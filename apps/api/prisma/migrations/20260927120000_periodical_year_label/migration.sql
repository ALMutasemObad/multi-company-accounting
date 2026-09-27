ALTER TABLE `inventory_items`
  ADD COLUMN `periodical_year` VARCHAR(40) NULL;

ALTER TABLE `inventory_barcode_settings`
  ADD COLUMN `show_periodical_year` BOOLEAN NOT NULL DEFAULT FALSE;
