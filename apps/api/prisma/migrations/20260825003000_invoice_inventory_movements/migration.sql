-- Trace invoice-driven stock effects without coupling Inventory to invoice tables.
-- Manual movements keep all source columns NULL; generated movements set all four.
ALTER TABLE `inventory_movements`
  ADD COLUMN `source_type` ENUM('SALES_INVOICE', 'SALES_CREDIT_NOTE', 'PURCHASE_INVOICE', 'PURCHASE_DEBIT_NOTE') NULL AFTER `external_reference`,
  ADD COLUMN `source_id` BIGINT UNSIGNED NULL AFTER `source_type`,
  ADD COLUMN `source_event` ENUM('POST', 'REVERSE') NULL AFTER `source_id`,
  ADD COLUMN `source_document_number_snapshot` VARCHAR(40) NULL AFTER `source_event`,
  ADD UNIQUE INDEX `inventory_movements_invoice_source_key`
    (`company_id`, `source_type`, `source_id`, `source_event`),
  ADD CONSTRAINT `inventory_movements_source_all_or_none_chk` CHECK (
    (`source_type` IS NULL AND `source_id` IS NULL AND `source_event` IS NULL AND `source_document_number_snapshot` IS NULL)
    OR
    (`source_type` IS NOT NULL AND `source_id` IS NOT NULL AND `source_event` IS NOT NULL AND `source_document_number_snapshot` IS NOT NULL)
  );
