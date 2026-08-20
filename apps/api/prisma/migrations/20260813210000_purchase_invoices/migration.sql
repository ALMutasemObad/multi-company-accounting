ALTER TABLE `accounting_documents`
  MODIFY `document_type` ENUM(
    'MANUAL_JOURNAL', 'RECEIPT', 'PAYMENT', 'PERIOD_CLOSE',
    'SALES_INVOICE', 'SALES_CREDIT_NOTE',
    'PURCHASE_INVOICE', 'PURCHASE_DEBIT_NOTE'
  ) NOT NULL;

ALTER TABLE `tax_rates`
  ADD COLUMN `input_tax_account_id` BIGINT UNSIGNED NULL AFTER `output_tax_account_id`,
  ADD INDEX `tax_rates_input_tax_account_id_company_id_idx` (`input_tax_account_id`, `company_id`),
  ADD CONSTRAINT `tax_rates_input_account_fkey`
    FOREIGN KEY (`input_tax_account_id`, `company_id`) REFERENCES `accounts` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `purchase_invoices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `accounting_document_id` BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `source_invoice_id` BIGINT UNSIGNED NULL,
  `ap_journal_line_id` BIGINT UNSIGNED NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `exchange_rate` DECIMAL(19,8) NOT NULL,
  `due_date` DATE NOT NULL,
  `subtotal` DECIMAL(19,4) NOT NULL,
  `discount_total` DECIMAL(19,4) NOT NULL,
  `taxable_total` DECIMAL(19,4) NOT NULL,
  `tax_total` DECIMAL(19,4) NOT NULL,
  `total` DECIMAL(19,4) NOT NULL,
  `base_total` DECIMAL(19,4) NOT NULL,
  `supplier_name_snapshot` VARCHAR(200) NOT NULL,
  `supplier_tax_last4` CHAR(4) NULL,
  `supplier_address_snapshot` VARCHAR(500) NULL,
  `supplier_invoice_number` VARCHAR(100) NULL,
  `notes` VARCHAR(1000) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_invoices_accounting_document_id_key` (`accounting_document_id`),
  UNIQUE INDEX `purchase_invoices_ap_journal_line_id_key` (`ap_journal_line_id`),
  UNIQUE INDEX `purchase_invoices_id_company_id_key` (`id`, `company_id`),
  UNIQUE INDEX `purchase_invoices_document_company_key` (`accounting_document_id`, `company_id`),
  UNIQUE INDEX `purchase_invoices_ap_line_company_key` (`ap_journal_line_id`, `company_id`),
  INDEX `purchase_invoices_company_supplier_due_idx` (`company_id`, `supplier_id`, `due_date`),
  INDEX `purchase_invoices_source_company_idx` (`source_invoice_id`, `company_id`),
  INDEX `purchase_invoices_supplier_number_idx` (`company_id`, `supplier_invoice_number`),
  CONSTRAINT `purchase_invoices_amounts_chk` CHECK (
    `subtotal` >= 0 AND `discount_total` >= 0 AND `discount_total` <= `subtotal`
    AND `taxable_total` >= 0 AND `tax_total` >= 0 AND `total` > 0
    AND `base_total` > 0 AND `exchange_rate` > 0
  ),
  CONSTRAINT `purchase_invoices_name_chk` CHECK (CHAR_LENGTH(TRIM(`supplier_name_snapshot`)) > 0),
  CONSTRAINT `purchase_invoices_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoices_document_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoices_supplier_fkey` FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoices_source_fkey` FOREIGN KEY (`source_invoice_id`, `company_id`) REFERENCES `purchase_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoices_ap_line_fkey` FOREIGN KEY (`ap_journal_line_id`, `company_id`) REFERENCES `journal_lines` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoices_currency_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_invoice_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `purchase_invoice_id` BIGINT UNSIGNED NOT NULL,
  `line_number` SMALLINT UNSIGNED NOT NULL,
  `debit_account_id` BIGINT UNSIGNED NOT NULL,
  `cost_center_id` BIGINT UNSIGNED NULL,
  `tax_rate_id` BIGINT UNSIGNED NULL,
  `description` VARCHAR(500) NOT NULL,
  `quantity` DECIMAL(19,4) NOT NULL,
  `unit_price` DECIMAL(19,4) NOT NULL,
  `discount_amount` DECIMAL(19,4) NOT NULL,
  `net_amount` DECIMAL(19,4) NOT NULL,
  `tax_rate_snapshot` DECIMAL(9,4) NOT NULL,
  `tax_amount` DECIMAL(19,4) NOT NULL,
  `total_amount` DECIMAL(19,4) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `purchase_invoice_lines_invoice_line_key` (`purchase_invoice_id`, `line_number`),
  INDEX `purchase_invoice_lines_company_debit_account_idx` (`company_id`, `debit_account_id`),
  INDEX `purchase_invoice_lines_company_tax_rate_idx` (`company_id`, `tax_rate_id`),
  INDEX `purchase_invoice_lines_cost_center_company_idx` (`cost_center_id`, `company_id`),
  CONSTRAINT `purchase_invoice_lines_values_chk` CHECK (
    `quantity` > 0 AND `unit_price` >= 0 AND `discount_amount` >= 0
    AND `net_amount` >= 0 AND `tax_rate_snapshot` >= 0 AND `tax_amount` >= 0 AND `total_amount` >= 0
  ),
  CONSTRAINT `purchase_invoice_lines_invoice_fkey` FOREIGN KEY (`purchase_invoice_id`, `company_id`) REFERENCES `purchase_invoices` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoice_lines_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoice_lines_debit_account_fkey` FOREIGN KEY (`debit_account_id`, `company_id`) REFERENCES `accounts` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoice_lines_cost_center_fkey` FOREIGN KEY (`cost_center_id`, `company_id`) REFERENCES `cost_centers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchase_invoice_lines_tax_rate_fkey` FOREIGN KEY (`tax_rate_id`, `company_id`) REFERENCES `tax_rates` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('purchase_invoices.view', 'purchase_invoices', 'عرض فواتير المشتريات والإشعارات المدينة'),
  ('purchase_invoices.create', 'purchase_invoices', 'إنشاء فواتير المشتريات والإشعارات المدينة'),
  ('purchase_invoices.update', 'purchase_invoices', 'تعديل فواتير المشتريات والإشعارات المدينة'),
  ('purchase_invoices.post', 'purchase_invoices', 'ترحيل فواتير المشتريات والإشعارات المدينة'),
  ('purchase_invoices.cancel', 'purchase_invoices', 'إلغاء مسودات فواتير المشتريات'),
  ('purchase_invoices.reverse', 'purchase_invoices', 'عكس فواتير المشتريات المرحلة'),
  ('input_tax_rates.manage', 'purchase_invoices', 'إدارة حساب ضريبة المدخلات'),
  ('reports.payables.view', 'reports', 'عرض أرصدة الموردين وأعمار الديون')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `r`.`id`, `p`.`id`
FROM `roles` `r`
JOIN `permissions` `p` ON `p`.`code` IN (
  'purchase_invoices.view', 'purchase_invoices.create', 'purchase_invoices.update',
  'purchase_invoices.post', 'purchase_invoices.cancel', 'purchase_invoices.reverse',
  'input_tax_rates.manage', 'reports.payables.view'
)
WHERE `r`.`code` = 'ADMINISTRATOR';
