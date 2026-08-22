-- Expand: introduce AR/AP-owned settlement aggregates before changing allocation identity.
CREATE TABLE `receivable_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `sales_invoice_id` BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `due_date` DATE NOT NULL,
  `original_amount` DECIMAL(19,4) NOT NULL,
  `outstanding_amount` DECIMAL(19,4) NOT NULL,
  `status` ENUM('OPEN', 'PARTIAL', 'SETTLED', 'REVERSED') NOT NULL DEFAULT 'OPEN',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `receivable_items_sales_invoice_id_key` (`sales_invoice_id`),
  UNIQUE INDEX `receivable_items_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `receivable_items_invoice_company_key` (`sales_invoice_id`, `company_id`),
  INDEX `receivable_items_company_customer_status_due_idx` (`company_id`, `customer_id`, `status`, `due_date`),
  CONSTRAINT `receivable_items_amounts_chk` CHECK (
    `original_amount` > 0
    AND `outstanding_amount` >= 0
    AND `outstanding_amount` <= `original_amount`
  ),
  CONSTRAINT `receivable_items_status_chk` CHECK (
    (`status` = 'OPEN' AND `outstanding_amount` = `original_amount`)
    OR (`status` = 'PARTIAL' AND `outstanding_amount` > 0 AND `outstanding_amount` < `original_amount`)
    OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_amount` = 0)
  ),
  CONSTRAINT `receivable_items_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `receivable_items_invoice_fkey` FOREIGN KEY (`sales_invoice_id`, `company_id`) REFERENCES `sales_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `receivable_items_customer_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `receivable_items_currency_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `payable_items` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `purchase_invoice_id` BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `due_date` DATE NOT NULL,
  `original_amount` DECIMAL(19,4) NOT NULL,
  `outstanding_amount` DECIMAL(19,4) NOT NULL,
  `status` ENUM('OPEN', 'PARTIAL', 'SETTLED', 'REVERSED') NOT NULL DEFAULT 'OPEN',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `payable_items_purchase_invoice_id_key` (`purchase_invoice_id`),
  UNIQUE INDEX `payable_items_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `payable_items_invoice_company_key` (`purchase_invoice_id`, `company_id`),
  INDEX `payable_items_company_supplier_status_due_idx` (`company_id`, `supplier_id`, `status`, `due_date`),
  CONSTRAINT `payable_items_amounts_chk` CHECK (
    `original_amount` > 0
    AND `outstanding_amount` >= 0
    AND `outstanding_amount` <= `original_amount`
  ),
  CONSTRAINT `payable_items_status_chk` CHECK (
    (`status` = 'OPEN' AND `outstanding_amount` = `original_amount`)
    OR (`status` = 'PARTIAL' AND `outstanding_amount` > 0 AND `outstanding_amount` < `original_amount`)
    OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_amount` = 0)
  ),
  CONSTRAINT `payable_items_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payable_items_invoice_fkey` FOREIGN KEY (`purchase_invoice_id`, `company_id`) REFERENCES `purchase_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payable_items_supplier_fkey` FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `payable_items_currency_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Backfill: reconstruct current aggregate state from posted, non-reversed settlements.
INSERT INTO `receivable_items` (
  `company_id`, `sales_invoice_id`, `customer_id`, `currency_id`, `due_date`,
  `original_amount`, `outstanding_amount`, `status`, `version`, `created_at`, `updated_at`
)
SELECT
  `historical`.`company_id`,
  `historical`.`sales_invoice_id`,
  `historical`.`customer_id`,
  `historical`.`currency_id`,
  `historical`.`due_date`,
  `historical`.`original_amount`,
  CASE
    WHEN `historical`.`document_status` = 'REVERSED'
      THEN CASE WHEN `historical`.`applied_amount` = 0 THEN 0 ELSE -1 END
    ELSE `historical`.`original_amount` - `historical`.`applied_amount`
  END,
  CASE
    WHEN `historical`.`document_status` = 'REVERSED' THEN 'REVERSED'
    WHEN `historical`.`applied_amount` = 0 THEN 'OPEN'
    WHEN `historical`.`applied_amount` = `historical`.`original_amount` THEN 'SETTLED'
    ELSE 'PARTIAL'
  END,
  0,
  `historical`.`created_at`,
  `historical`.`updated_at`
FROM (
  SELECT
    `si`.`company_id`,
    `si`.`id` AS `sales_invoice_id`,
    `si`.`customer_id`,
    `si`.`currency_id`,
    `si`.`due_date`,
    `si`.`total` AS `original_amount`,
    `ad`.`status` AS `document_status`,
    COALESCE(`settlements`.`amount`, 0) + COALESCE(`credits`.`amount`, 0) AS `applied_amount`,
    `ad`.`created_at`,
    `ad`.`updated_at`
  FROM `sales_invoices` `si`
  JOIN `accounting_documents` `ad`
    ON `ad`.`id` = `si`.`accounting_document_id`
   AND `ad`.`company_id` = `si`.`company_id`
   AND `ad`.`document_type` = 'SALES_INVOICE'
   AND `ad`.`status` IN ('POSTED', 'REVERSED')
  LEFT JOIN (
    SELECT `ra`.`company_id`, `ra`.`target_journal_line_id`, SUM(`ra`.`allocated_amount`) AS `amount`
    FROM `receipt_allocations` `ra`
    JOIN `receipts` `r` ON `r`.`id` = `ra`.`receipt_id` AND `r`.`company_id` = `ra`.`company_id`
    JOIN `accounting_documents` `rd` ON `rd`.`id` = `r`.`accounting_document_id` AND `rd`.`company_id` = `r`.`company_id` AND `rd`.`status` = 'POSTED'
    GROUP BY `ra`.`company_id`, `ra`.`target_journal_line_id`
  ) `settlements`
    ON `settlements`.`company_id` = `si`.`company_id`
   AND `settlements`.`target_journal_line_id` = `si`.`ar_journal_line_id`
  LEFT JOIN (
    SELECT `cn`.`company_id`, `cn`.`source_invoice_id`, SUM(`cn`.`total`) AS `amount`
    FROM `sales_invoices` `cn`
    JOIN `accounting_documents` `cd` ON `cd`.`id` = `cn`.`accounting_document_id` AND `cd`.`company_id` = `cn`.`company_id` AND `cd`.`document_type` = 'SALES_CREDIT_NOTE' AND `cd`.`status` = 'POSTED'
    GROUP BY `cn`.`company_id`, `cn`.`source_invoice_id`
  ) `credits`
    ON `credits`.`company_id` = `si`.`company_id`
   AND `credits`.`source_invoice_id` = `si`.`id`
) `historical`;

INSERT INTO `payable_items` (
  `company_id`, `purchase_invoice_id`, `supplier_id`, `currency_id`, `due_date`,
  `original_amount`, `outstanding_amount`, `status`, `version`, `created_at`, `updated_at`
)
SELECT
  `historical`.`company_id`,
  `historical`.`purchase_invoice_id`,
  `historical`.`supplier_id`,
  `historical`.`currency_id`,
  `historical`.`due_date`,
  `historical`.`original_amount`,
  CASE
    WHEN `historical`.`document_status` = 'REVERSED'
      THEN CASE WHEN `historical`.`applied_amount` = 0 THEN 0 ELSE -1 END
    ELSE `historical`.`original_amount` - `historical`.`applied_amount`
  END,
  CASE
    WHEN `historical`.`document_status` = 'REVERSED' THEN 'REVERSED'
    WHEN `historical`.`applied_amount` = 0 THEN 'OPEN'
    WHEN `historical`.`applied_amount` = `historical`.`original_amount` THEN 'SETTLED'
    ELSE 'PARTIAL'
  END,
  0,
  `historical`.`created_at`,
  `historical`.`updated_at`
FROM (
  SELECT
    `pi`.`company_id`,
    `pi`.`id` AS `purchase_invoice_id`,
    `pi`.`supplier_id`,
    `pi`.`currency_id`,
    `pi`.`due_date`,
    `pi`.`total` AS `original_amount`,
    `ad`.`status` AS `document_status`,
    COALESCE(`settlements`.`amount`, 0) + COALESCE(`debits`.`amount`, 0) AS `applied_amount`,
    `ad`.`created_at`,
    `ad`.`updated_at`
  FROM `purchase_invoices` `pi`
  JOIN `accounting_documents` `ad`
    ON `ad`.`id` = `pi`.`accounting_document_id`
   AND `ad`.`company_id` = `pi`.`company_id`
   AND `ad`.`document_type` = 'PURCHASE_INVOICE'
   AND `ad`.`status` IN ('POSTED', 'REVERSED')
  LEFT JOIN (
    SELECT `pa`.`company_id`, `pa`.`target_journal_line_id`, SUM(`pa`.`allocated_amount`) AS `amount`
    FROM `payment_allocations` `pa`
    JOIN `payments` `p` ON `p`.`id` = `pa`.`payment_id` AND `p`.`company_id` = `pa`.`company_id`
    JOIN `accounting_documents` `pd` ON `pd`.`id` = `p`.`accounting_document_id` AND `pd`.`company_id` = `p`.`company_id` AND `pd`.`status` = 'POSTED'
    GROUP BY `pa`.`company_id`, `pa`.`target_journal_line_id`
  ) `settlements`
    ON `settlements`.`company_id` = `pi`.`company_id`
   AND `settlements`.`target_journal_line_id` = `pi`.`ap_journal_line_id`
  LEFT JOIN (
    SELECT `dn`.`company_id`, `dn`.`source_invoice_id`, SUM(`dn`.`total`) AS `amount`
    FROM `purchase_invoices` `dn`
    JOIN `accounting_documents` `dd` ON `dd`.`id` = `dn`.`accounting_document_id` AND `dd`.`company_id` = `dn`.`company_id` AND `dd`.`document_type` = 'PURCHASE_DEBIT_NOTE' AND `dd`.`status` = 'POSTED'
    GROUP BY `dn`.`company_id`, `dn`.`source_invoice_id`
  ) `debits`
    ON `debits`.`company_id` = `pi`.`company_id`
   AND `debits`.`source_invoice_id` = `pi`.`id`
) `historical`;

-- Migrate allocation foreign keys. Making the new columns NOT NULL is the
-- deployment guard: historical allocations that cannot be mapped abort safely.
ALTER TABLE `receipt_allocations`
  ADD COLUMN `receivable_item_id` BIGINT UNSIGNED NULL AFTER `receipt_id`;

UPDATE `receipt_allocations` `ra`
JOIN `sales_invoices` `si`
  ON `si`.`company_id` = `ra`.`company_id`
 AND `si`.`ar_journal_line_id` = `ra`.`target_journal_line_id`
JOIN `receivable_items` `ri`
  ON `ri`.`company_id` = `si`.`company_id`
 AND `ri`.`sales_invoice_id` = `si`.`id`
SET `ra`.`receivable_item_id` = `ri`.`id`;

-- MariaDB can coerce NULL to zero while tightening a column even in deployments
-- that expect strict mode. Force an engine-enforced CHECK failure first so an
-- unmappable historical allocation can never be contracted silently.
CREATE TEMPORARY TABLE `_receipt_allocation_migration_guard` (
  `is_valid` TINYINT NOT NULL,
  CONSTRAINT `_receipt_allocation_migration_guard_chk` CHECK (`is_valid` = 1)
);

INSERT INTO `_receipt_allocation_migration_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `receipt_allocations`
WHERE `receivable_item_id` IS NULL;

DROP TEMPORARY TABLE `_receipt_allocation_migration_guard`;

ALTER TABLE `receipt_allocations`
  MODIFY `receivable_item_id` BIGINT UNSIGNED NOT NULL,
  DROP FOREIGN KEY `receipt_allocations_target_journal_line_id_company_id_fkey`,
  DROP INDEX `receipt_allocations_company_id_target_journal_line_id_idx`,
  DROP INDEX `receipt_allocations_receipt_id_target_journal_line_id_key`,
  DROP COLUMN `target_journal_line_id`,
  ADD UNIQUE INDEX `receipt_allocations_receipt_item_key` (`receipt_id`, `receivable_item_id`),
  ADD INDEX `receipt_allocations_company_item_idx` (`company_id`, `receivable_item_id`),
  ADD CONSTRAINT `receipt_allocations_item_fkey` FOREIGN KEY (`receivable_item_id`, `company_id`) REFERENCES `receivable_items` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `payment_allocations`
  ADD COLUMN `payable_item_id` BIGINT UNSIGNED NULL AFTER `payment_id`;

UPDATE `payment_allocations` `pa`
JOIN `purchase_invoices` `pi`
  ON `pi`.`company_id` = `pa`.`company_id`
 AND `pi`.`ap_journal_line_id` = `pa`.`target_journal_line_id`
JOIN `payable_items` `pii`
  ON `pii`.`company_id` = `pi`.`company_id`
 AND `pii`.`purchase_invoice_id` = `pi`.`id`
SET `pa`.`payable_item_id` = `pii`.`id`;

CREATE TEMPORARY TABLE `_payment_allocation_migration_guard` (
  `is_valid` TINYINT NOT NULL,
  CONSTRAINT `_payment_allocation_migration_guard_chk` CHECK (`is_valid` = 1)
);

INSERT INTO `_payment_allocation_migration_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `payment_allocations`
WHERE `payable_item_id` IS NULL;

DROP TEMPORARY TABLE `_payment_allocation_migration_guard`;

ALTER TABLE `payment_allocations`
  MODIFY `payable_item_id` BIGINT UNSIGNED NOT NULL,
  DROP FOREIGN KEY `payment_allocations_target_journal_line_id_company_id_fkey`,
  DROP INDEX `payment_allocations_company_id_target_journal_line_id_idx`,
  DROP INDEX `payment_allocations_payment_id_target_journal_line_id_key`,
  DROP COLUMN `target_journal_line_id`,
  ADD UNIQUE INDEX `payment_allocations_payment_item_key` (`payment_id`, `payable_item_id`),
  ADD INDEX `payment_allocations_company_item_idx` (`company_id`, `payable_item_id`),
  ADD CONSTRAINT `payment_allocations_item_fkey` FOREIGN KEY (`payable_item_id`, `company_id`) REFERENCES `payable_items` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
