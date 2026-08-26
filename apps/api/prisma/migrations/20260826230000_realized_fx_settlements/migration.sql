-- The old binary reduced AR/AP at the settlement rate but did not create an FX
-- line. An active historical rate mismatch therefore cannot be repaired safely
-- by a schema migration, especially when the period is closed. Fail closed so
-- the operator can reverse that settlement before applying this migration.
CREATE TEMPORARY TABLE `_realized_fx_cutover_guard` (
  `is_valid` TINYINT NOT NULL,
  CONSTRAINT `_realized_fx_cutover_guard_chk` CHECK (`is_valid` = 1)
);

INSERT INTO `_realized_fx_cutover_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `receipt_allocations` `ra`
JOIN `receipts` `r`
  ON `r`.`id` = `ra`.`receipt_id`
 AND `r`.`company_id` = `ra`.`company_id`
JOIN `accounting_documents` `rd`
  ON `rd`.`id` = `r`.`accounting_document_id`
 AND `rd`.`company_id` = `r`.`company_id`
 AND `rd`.`status` = 'POSTED'
JOIN `receivable_items` `ri`
  ON `ri`.`id` = `ra`.`receivable_item_id`
 AND `ri`.`company_id` = `ra`.`company_id`
JOIN `sales_invoices` `si`
  ON `si`.`id` = `ri`.`sales_invoice_id`
 AND `si`.`company_id` = `ri`.`company_id`
WHERE `r`.`exchange_rate` <> `si`.`exchange_rate`;

DELETE FROM `_realized_fx_cutover_guard`;

INSERT INTO `_realized_fx_cutover_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `payment_allocations` `pa`
JOIN `payments` `p`
  ON `p`.`id` = `pa`.`payment_id`
 AND `p`.`company_id` = `pa`.`company_id`
JOIN `accounting_documents` `pd`
  ON `pd`.`id` = `p`.`accounting_document_id`
 AND `pd`.`company_id` = `p`.`company_id`
 AND `pd`.`status` = 'POSTED'
JOIN `payable_items` `pii`
  ON `pii`.`id` = `pa`.`payable_item_id`
 AND `pii`.`company_id` = `pa`.`company_id`
JOIN `purchase_invoices` `pi`
  ON `pi`.`id` = `pii`.`purchase_invoice_id`
 AND `pi`.`company_id` = `pii`.`company_id`
WHERE `p`.`exchange_rate` <> `pi`.`exchange_rate`;

DELETE FROM `_realized_fx_cutover_guard`;

INSERT INTO `_realized_fx_cutover_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `sales_invoices` `credit_note`
JOIN `accounting_documents` `credit_document`
  ON `credit_document`.`id` = `credit_note`.`accounting_document_id`
 AND `credit_document`.`company_id` = `credit_note`.`company_id`
 AND `credit_document`.`document_type` = 'SALES_CREDIT_NOTE'
 AND `credit_document`.`status` = 'POSTED'
JOIN `sales_invoices` `source_invoice`
  ON `source_invoice`.`id` = `credit_note`.`source_invoice_id`
 AND `source_invoice`.`company_id` = `credit_note`.`company_id`
WHERE `credit_note`.`exchange_rate` <> `source_invoice`.`exchange_rate`;

DELETE FROM `_realized_fx_cutover_guard`;

INSERT INTO `_realized_fx_cutover_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `purchase_invoices` `debit_note`
JOIN `accounting_documents` `debit_document`
  ON `debit_document`.`id` = `debit_note`.`accounting_document_id`
 AND `debit_document`.`company_id` = `debit_note`.`company_id`
 AND `debit_document`.`document_type` = 'PURCHASE_DEBIT_NOTE'
 AND `debit_document`.`status` = 'POSTED'
JOIN `purchase_invoices` `source_invoice`
  ON `source_invoice`.`id` = `debit_note`.`source_invoice_id`
 AND `source_invoice`.`company_id` = `debit_note`.`company_id`
WHERE `debit_note`.`exchange_rate` <> `source_invoice`.`exchange_rate`;

DROP TEMPORARY TABLE `_realized_fx_cutover_guard`;

-- Track both the transaction-currency balance and its exact carrying value in
-- the company base currency. Allocation snapshots make reversal independent
-- from later exchange-rate or master-data changes. The non-mutating historical
-- cutover guard runs first because MySQL/MariaDB DDL is not transactionally
-- rolled back when a later statement fails.
ALTER TABLE `receivable_items`
  ADD COLUMN `original_base_amount` DECIMAL(19,4) NULL AFTER `outstanding_amount`,
  ADD COLUMN `outstanding_base_amount` DECIMAL(19,4) NULL AFTER `original_base_amount`;

ALTER TABLE `payable_items`
  ADD COLUMN `original_base_amount` DECIMAL(19,4) NULL AFTER `outstanding_amount`,
  ADD COLUMN `outstanding_base_amount` DECIMAL(19,4) NULL AFTER `original_base_amount`;

ALTER TABLE `receipt_allocations`
  ADD COLUMN `carrying_base_amount` DECIMAL(19,4) NULL AFTER `allocated_amount`,
  ADD COLUMN `settlement_base_amount` DECIMAL(19,4) NULL AFTER `carrying_base_amount`,
  ADD COLUMN `realized_fx_base_amount` DECIMAL(19,4) NULL AFTER `settlement_base_amount`;

ALTER TABLE `payment_allocations`
  ADD COLUMN `carrying_base_amount` DECIMAL(19,4) NULL AFTER `allocated_amount`,
  ADD COLUMN `settlement_base_amount` DECIMAL(19,4) NULL AFTER `carrying_base_amount`,
  ADD COLUMN `realized_fx_base_amount` DECIMAL(19,4) NULL AFTER `settlement_base_amount`;

-- Allocate each historical document's exact base total across its rows. The
-- final row absorbs the rounding residual, so snapshots sum to the journal line.
CREATE TEMPORARY TABLE `_receipt_allocation_base_backfill` AS
SELECT
  `ranked`.`id`,
  CASE
    WHEN `ranked`.`row_number` = `ranked`.`row_count`
      THEN `ranked`.`base_amount` - (`ranked`.`rounded_total` - `ranked`.`rounded_amount`)
    ELSE `ranked`.`rounded_amount`
  END AS `base_amount`
FROM (
  SELECT
    `ra`.`id`,
    `r`.`base_amount`,
    ROUND(`ra`.`allocated_amount` * `r`.`exchange_rate`, 4) AS `rounded_amount`,
    ROW_NUMBER() OVER (PARTITION BY `ra`.`receipt_id` ORDER BY `ra`.`id`) AS `row_number`,
    COUNT(*) OVER (PARTITION BY `ra`.`receipt_id`) AS `row_count`,
    SUM(ROUND(`ra`.`allocated_amount` * `r`.`exchange_rate`, 4))
      OVER (PARTITION BY `ra`.`receipt_id`) AS `rounded_total`
  FROM `receipt_allocations` `ra`
  JOIN `receipts` `r`
    ON `r`.`id` = `ra`.`receipt_id`
   AND `r`.`company_id` = `ra`.`company_id`
  JOIN `accounting_documents` `rd`
    ON `rd`.`id` = `r`.`accounting_document_id`
   AND `rd`.`company_id` = `r`.`company_id`
   AND `rd`.`status` IN ('POSTED', 'REVERSED')
) `ranked`;

UPDATE `receipt_allocations` `ra`
JOIN `_receipt_allocation_base_backfill` `backfill`
  ON `backfill`.`id` = `ra`.`id`
SET
  `ra`.`carrying_base_amount` = `backfill`.`base_amount`,
  `ra`.`settlement_base_amount` = `backfill`.`base_amount`,
  `ra`.`realized_fx_base_amount` = 0.0000;

DROP TEMPORARY TABLE `_receipt_allocation_base_backfill`;

CREATE TEMPORARY TABLE `_payment_allocation_base_backfill` AS
SELECT
  `ranked`.`id`,
  CASE
    WHEN `ranked`.`row_number` = `ranked`.`row_count`
      THEN `ranked`.`base_amount` - (`ranked`.`rounded_total` - `ranked`.`rounded_amount`)
    ELSE `ranked`.`rounded_amount`
  END AS `base_amount`
FROM (
  SELECT
    `pa`.`id`,
    `p`.`base_amount`,
    ROUND(`pa`.`allocated_amount` * `p`.`exchange_rate`, 4) AS `rounded_amount`,
    ROW_NUMBER() OVER (PARTITION BY `pa`.`payment_id` ORDER BY `pa`.`id`) AS `row_number`,
    COUNT(*) OVER (PARTITION BY `pa`.`payment_id`) AS `row_count`,
    SUM(ROUND(`pa`.`allocated_amount` * `p`.`exchange_rate`, 4))
      OVER (PARTITION BY `pa`.`payment_id`) AS `rounded_total`
  FROM `payment_allocations` `pa`
  JOIN `payments` `p`
    ON `p`.`id` = `pa`.`payment_id`
   AND `p`.`company_id` = `pa`.`company_id`
  JOIN `accounting_documents` `pd`
    ON `pd`.`id` = `p`.`accounting_document_id`
   AND `pd`.`company_id` = `p`.`company_id`
   AND `pd`.`status` IN ('POSTED', 'REVERSED')
) `ranked`;

UPDATE `payment_allocations` `pa`
JOIN `_payment_allocation_base_backfill` `backfill`
  ON `backfill`.`id` = `pa`.`id`
SET
  `pa`.`carrying_base_amount` = `backfill`.`base_amount`,
  `pa`.`settlement_base_amount` = `backfill`.`base_amount`,
  `pa`.`realized_fx_base_amount` = 0.0000;

DROP TEMPORARY TABLE `_payment_allocation_base_backfill`;

UPDATE `receivable_items` `ri`
JOIN `sales_invoices` `si`
  ON `si`.`id` = `ri`.`sales_invoice_id`
 AND `si`.`company_id` = `ri`.`company_id`
SET `ri`.`original_base_amount` = `si`.`base_total`;

UPDATE `payable_items` `pii`
JOIN `purchase_invoices` `pi`
  ON `pi`.`id` = `pii`.`purchase_invoice_id`
 AND `pi`.`company_id` = `pii`.`company_id`
SET `pii`.`original_base_amount` = `pi`.`base_total`;

UPDATE `receivable_items` `ri`
JOIN `sales_invoices` `si`
  ON `si`.`id` = `ri`.`sales_invoice_id`
 AND `si`.`company_id` = `ri`.`company_id`
LEFT JOIN (
  SELECT `ra`.`receivable_item_id`, `ra`.`company_id`, SUM(`ra`.`carrying_base_amount`) AS `base_amount`
  FROM `receipt_allocations` `ra`
  JOIN `receipts` `r`
    ON `r`.`id` = `ra`.`receipt_id`
   AND `r`.`company_id` = `ra`.`company_id`
  JOIN `accounting_documents` `rd`
    ON `rd`.`id` = `r`.`accounting_document_id`
   AND `rd`.`company_id` = `r`.`company_id`
   AND `rd`.`status` = 'POSTED'
  GROUP BY `ra`.`receivable_item_id`, `ra`.`company_id`
) `settlements`
  ON `settlements`.`receivable_item_id` = `ri`.`id`
 AND `settlements`.`company_id` = `ri`.`company_id`
LEFT JOIN (
  SELECT `credit_note`.`source_invoice_id`, `credit_note`.`company_id`, SUM(`credit_note`.`base_total`) AS `base_amount`
  FROM `sales_invoices` `credit_note`
  JOIN `accounting_documents` `credit_document`
    ON `credit_document`.`id` = `credit_note`.`accounting_document_id`
   AND `credit_document`.`company_id` = `credit_note`.`company_id`
   AND `credit_document`.`document_type` = 'SALES_CREDIT_NOTE'
   AND `credit_document`.`status` = 'POSTED'
  GROUP BY `credit_note`.`source_invoice_id`, `credit_note`.`company_id`
) `credits`
  ON `credits`.`source_invoice_id` = `si`.`id`
 AND `credits`.`company_id` = `si`.`company_id`
SET `ri`.`outstanding_base_amount` = CASE
  WHEN `ri`.`status` = 'REVERSED' THEN 0.0000
  ELSE ROUND(`si`.`base_total`
    - COALESCE(`settlements`.`base_amount`, 0.0000)
    - COALESCE(`credits`.`base_amount`, 0.0000), 4)
END;

UPDATE `payable_items` `pii`
JOIN `purchase_invoices` `pi`
  ON `pi`.`id` = `pii`.`purchase_invoice_id`
 AND `pi`.`company_id` = `pii`.`company_id`
LEFT JOIN (
  SELECT `pa`.`payable_item_id`, `pa`.`company_id`, SUM(`pa`.`carrying_base_amount`) AS `base_amount`
  FROM `payment_allocations` `pa`
  JOIN `payments` `p`
    ON `p`.`id` = `pa`.`payment_id`
   AND `p`.`company_id` = `pa`.`company_id`
  JOIN `accounting_documents` `pd`
    ON `pd`.`id` = `p`.`accounting_document_id`
   AND `pd`.`company_id` = `p`.`company_id`
   AND `pd`.`status` = 'POSTED'
  GROUP BY `pa`.`payable_item_id`, `pa`.`company_id`
) `settlements`
  ON `settlements`.`payable_item_id` = `pii`.`id`
 AND `settlements`.`company_id` = `pii`.`company_id`
LEFT JOIN (
  SELECT `debit_note`.`source_invoice_id`, `debit_note`.`company_id`, SUM(`debit_note`.`base_total`) AS `base_amount`
  FROM `purchase_invoices` `debit_note`
  JOIN `accounting_documents` `debit_document`
    ON `debit_document`.`id` = `debit_note`.`accounting_document_id`
   AND `debit_document`.`company_id` = `debit_note`.`company_id`
   AND `debit_document`.`document_type` = 'PURCHASE_DEBIT_NOTE'
   AND `debit_document`.`status` = 'POSTED'
  GROUP BY `debit_note`.`source_invoice_id`, `debit_note`.`company_id`
) `debits`
  ON `debits`.`source_invoice_id` = `pi`.`id`
 AND `debits`.`company_id` = `pi`.`company_id`
SET `pii`.`outstanding_base_amount` = CASE
  WHEN `pii`.`status` = 'REVERSED' THEN 0.0000
  ELSE ROUND(`pi`.`base_total`
    - COALESCE(`settlements`.`base_amount`, 0.0000)
    - COALESCE(`debits`.`base_amount`, 0.0000), 4)
END;

CREATE TEMPORARY TABLE `_settlement_base_balance_guard` (
  `is_valid` TINYINT NOT NULL,
  CONSTRAINT `_settlement_base_balance_guard_chk` CHECK (`is_valid` = 1)
);

INSERT INTO `_settlement_base_balance_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `receivable_items`
WHERE `original_base_amount` IS NULL
   OR `original_base_amount` <= 0
   OR `outstanding_base_amount` IS NULL
   OR `outstanding_base_amount` < 0
   OR `outstanding_base_amount` > `original_base_amount`
   OR (`status` = 'OPEN' AND `outstanding_base_amount` <> `original_base_amount`)
   OR (`status` = 'PARTIAL' AND (`outstanding_base_amount` <= 0 OR `outstanding_base_amount` >= `original_base_amount`))
   OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_base_amount` <> 0);

DELETE FROM `_settlement_base_balance_guard`;

INSERT INTO `_settlement_base_balance_guard` (`is_valid`)
SELECT CASE WHEN COUNT(*) = 0 THEN 1 ELSE 0 END
FROM `payable_items`
WHERE `original_base_amount` IS NULL
   OR `original_base_amount` <= 0
   OR `outstanding_base_amount` IS NULL
   OR `outstanding_base_amount` < 0
   OR `outstanding_base_amount` > `original_base_amount`
   OR (`status` = 'OPEN' AND `outstanding_base_amount` <> `original_base_amount`)
   OR (`status` = 'PARTIAL' AND (`outstanding_base_amount` <= 0 OR `outstanding_base_amount` >= `original_base_amount`))
   OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_base_amount` <> 0);

DROP TEMPORARY TABLE `_settlement_base_balance_guard`;

ALTER TABLE `receivable_items`
  MODIFY `original_base_amount` DECIMAL(19,4) NOT NULL,
  MODIFY `outstanding_base_amount` DECIMAL(19,4) NOT NULL,
  ADD CONSTRAINT `receivable_items_base_amounts_chk` CHECK (
    `original_base_amount` > 0
    AND `outstanding_base_amount` >= 0
    AND `outstanding_base_amount` <= `original_base_amount`
  ),
  ADD CONSTRAINT `receivable_items_base_status_chk` CHECK (
    (`status` = 'OPEN' AND `outstanding_base_amount` = `original_base_amount`)
    OR (`status` = 'PARTIAL' AND `outstanding_base_amount` > 0 AND `outstanding_base_amount` < `original_base_amount`)
    OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_base_amount` = 0)
  );

ALTER TABLE `payable_items`
  MODIFY `original_base_amount` DECIMAL(19,4) NOT NULL,
  MODIFY `outstanding_base_amount` DECIMAL(19,4) NOT NULL,
  ADD CONSTRAINT `payable_items_base_amounts_chk` CHECK (
    `original_base_amount` > 0
    AND `outstanding_base_amount` >= 0
    AND `outstanding_base_amount` <= `original_base_amount`
  ),
  ADD CONSTRAINT `payable_items_base_status_chk` CHECK (
    (`status` = 'OPEN' AND `outstanding_base_amount` = `original_base_amount`)
    OR (`status` = 'PARTIAL' AND `outstanding_base_amount` > 0 AND `outstanding_base_amount` < `original_base_amount`)
    OR (`status` IN ('SETTLED', 'REVERSED') AND `outstanding_base_amount` = 0)
  );

ALTER TABLE `receipt_allocations`
  ADD CONSTRAINT `receipt_allocations_fx_snapshot_chk` CHECK (
    (`carrying_base_amount` IS NULL AND `settlement_base_amount` IS NULL AND `realized_fx_base_amount` IS NULL)
    OR (
      `carrying_base_amount` IS NOT NULL
      AND `settlement_base_amount` IS NOT NULL
      AND `realized_fx_base_amount` IS NOT NULL
      AND `carrying_base_amount` > 0
      AND `settlement_base_amount` > 0
      AND `realized_fx_base_amount` = `settlement_base_amount` - `carrying_base_amount`
    )
  );

ALTER TABLE `payment_allocations`
  ADD CONSTRAINT `payment_allocations_fx_snapshot_chk` CHECK (
    (`carrying_base_amount` IS NULL AND `settlement_base_amount` IS NULL AND `realized_fx_base_amount` IS NULL)
    OR (
      `carrying_base_amount` IS NOT NULL
      AND `settlement_base_amount` IS NOT NULL
      AND `realized_fx_base_amount` IS NOT NULL
      AND `carrying_base_amount` > 0
      AND `settlement_base_amount` > 0
      AND `realized_fx_base_amount` = `carrying_base_amount` - `settlement_base_amount`
    )
  );

-- Extend the default chart with dedicated realized FX accounts. Existing code
-- 4220/5520 rows are linked only when their parent, type and posting flags are
-- already compatible; a conflicting custom chart remains untouched and posting
-- fails explicitly only when an FX difference actually needs an account.
UPDATE `accounts` `candidate`
JOIN `accounts` `parent`
  ON `parent`.`company_id` = `candidate`.`company_id`
 AND `parent`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `parent`.`source_template_key` = 'other-income'
JOIN `account_types` `account_type`
  ON `account_type`.`id` = `candidate`.`account_type_id`
 AND `account_type`.`code` = 'REVENUE'
LEFT JOIN `accounts` `marked`
  ON `marked`.`company_id` = `candidate`.`company_id`
 AND `marked`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `marked`.`source_template_key` = 'realized-fx-gain'
SET
  `candidate`.`source_template_code` = 'SMALL_BUSINESS_GENERAL',
  `candidate`.`source_template_key` = 'realized-fx-gain'
WHERE `candidate`.`code` = '4220'
  AND `candidate`.`parent_account_id` = `parent`.`id`
  AND `candidate`.`allows_posting` = true
  AND `candidate`.`source_template_code` IS NULL
  AND `candidate`.`source_template_key` IS NULL
  AND `marked`.`id` IS NULL;

INSERT INTO `accounts` (
  `company_id`, `account_type_id`, `parent_account_id`, `code`, `name_ar`, `name_en`,
  `level`, `allows_posting`, `is_control_account`, `is_active`,
  `source_template_code`, `source_template_key`, `updated_at`
)
SELECT
  `parent`.`company_id`, `account_type`.`id`, `parent`.`id`, '4220',
  'أرباح فروق العملة المحققة', 'Realized foreign exchange gains',
  `parent`.`level` + 1, true, false, true,
  'SMALL_BUSINESS_GENERAL', 'realized-fx-gain', CURRENT_TIMESTAMP(3)
FROM `accounts` `parent`
JOIN `account_types` `account_type` ON `account_type`.`code` = 'REVENUE'
LEFT JOIN `accounts` `marked`
  ON `marked`.`company_id` = `parent`.`company_id`
 AND `marked`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `marked`.`source_template_key` = 'realized-fx-gain'
LEFT JOIN `accounts` `by_code`
  ON `by_code`.`company_id` = `parent`.`company_id`
 AND `by_code`.`code` = '4220'
WHERE `parent`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
  AND `parent`.`source_template_key` = 'other-income'
  AND `marked`.`id` IS NULL
  AND `by_code`.`id` IS NULL;

UPDATE `accounts` `candidate`
JOIN `accounts` `parent`
  ON `parent`.`company_id` = `candidate`.`company_id`
 AND `parent`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `parent`.`source_template_key` = 'other-expenses'
JOIN `account_types` `account_type`
  ON `account_type`.`id` = `candidate`.`account_type_id`
 AND `account_type`.`code` = 'EXPENSE'
LEFT JOIN `accounts` `marked`
  ON `marked`.`company_id` = `candidate`.`company_id`
 AND `marked`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `marked`.`source_template_key` = 'realized-fx-loss'
SET
  `candidate`.`source_template_code` = 'SMALL_BUSINESS_GENERAL',
  `candidate`.`source_template_key` = 'realized-fx-loss'
WHERE `candidate`.`code` = '5520'
  AND `candidate`.`parent_account_id` = `parent`.`id`
  AND `candidate`.`allows_posting` = true
  AND `candidate`.`source_template_code` IS NULL
  AND `candidate`.`source_template_key` IS NULL
  AND `marked`.`id` IS NULL;

INSERT INTO `accounts` (
  `company_id`, `account_type_id`, `parent_account_id`, `code`, `name_ar`, `name_en`,
  `level`, `allows_posting`, `is_control_account`, `is_active`,
  `source_template_code`, `source_template_key`, `updated_at`
)
SELECT
  `parent`.`company_id`, `account_type`.`id`, `parent`.`id`, '5520',
  'خسائر فروق العملة المحققة', 'Realized foreign exchange losses',
  `parent`.`level` + 1, true, false, true,
  'SMALL_BUSINESS_GENERAL', 'realized-fx-loss', CURRENT_TIMESTAMP(3)
FROM `accounts` `parent`
JOIN `account_types` `account_type` ON `account_type`.`code` = 'EXPENSE'
LEFT JOIN `accounts` `marked`
  ON `marked`.`company_id` = `parent`.`company_id`
 AND `marked`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
 AND `marked`.`source_template_key` = 'realized-fx-loss'
LEFT JOIN `accounts` `by_code`
  ON `by_code`.`company_id` = `parent`.`company_id`
 AND `by_code`.`code` = '5520'
WHERE `parent`.`source_template_code` = 'SMALL_BUSINESS_GENERAL'
  AND `parent`.`source_template_key` = 'other-expenses'
  AND `marked`.`id` IS NULL
  AND `by_code`.`id` IS NULL;
