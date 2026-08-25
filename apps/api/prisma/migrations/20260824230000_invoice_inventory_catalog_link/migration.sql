-- Link sales and purchase invoice drafts to Inventory master data without
-- claiming stock balances, movements, or costing in this slice.
ALTER TABLE `sales_invoices`
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `warehouse_code_snapshot` VARCHAR(40) NULL,
  ADD COLUMN `warehouse_name_snapshot` VARCHAR(160) NULL,
  ADD INDEX `sales_invoices_company_id_warehouse_id_idx` (`company_id`, `warehouse_id`),
  ADD CONSTRAINT `sales_invoices_warehouse_id_company_id_fkey`
    FOREIGN KEY (`warehouse_id`, `company_id`) REFERENCES `warehouses`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `purchase_invoices`
  ADD COLUMN `warehouse_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `warehouse_code_snapshot` VARCHAR(40) NULL,
  ADD COLUMN `warehouse_name_snapshot` VARCHAR(160) NULL,
  ADD INDEX `purchase_invoices_company_id_warehouse_id_idx` (`company_id`, `warehouse_id`),
  ADD CONSTRAINT `purchase_invoices_warehouse_id_company_id_fkey`
    FOREIGN KEY (`warehouse_id`, `company_id`) REFERENCES `warehouses`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `sales_invoice_lines`
  MODIFY COLUMN `quantity` DECIMAL(19, 6) NOT NULL,
  ADD COLUMN `inventory_item_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `inventory_item_code_snapshot` VARCHAR(40) NULL,
  ADD COLUMN `inventory_item_name_snapshot` VARCHAR(200) NULL,
  ADD COLUMN `unit_of_measure_code_snapshot` VARCHAR(20) NULL,
  ADD INDEX `sales_invoice_lines_company_id_inventory_item_id_idx` (`company_id`, `inventory_item_id`),
  ADD CONSTRAINT `sales_invoice_lines_inventory_item_id_company_id_fkey`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `purchase_invoice_lines`
  MODIFY COLUMN `quantity` DECIMAL(19, 6) NOT NULL,
  ADD COLUMN `inventory_item_id` BIGINT UNSIGNED NULL,
  ADD COLUMN `inventory_item_code_snapshot` VARCHAR(40) NULL,
  ADD COLUMN `inventory_item_name_snapshot` VARCHAR(200) NULL,
  ADD COLUMN `unit_of_measure_code_snapshot` VARCHAR(20) NULL,
  ADD INDEX `purchase_invoice_lines_company_id_inventory_item_id_idx` (`company_id`, `inventory_item_id`),
  ADD CONSTRAINT `purchase_invoice_lines_inventory_item_id_company_id_fkey`
    FOREIGN KEY (`inventory_item_id`, `company_id`) REFERENCES `inventory_items`(`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT;
