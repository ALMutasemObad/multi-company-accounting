ALTER TABLE `accounting_documents`
  MODIFY `document_type` ENUM('MANUAL_JOURNAL', 'RECEIPT', 'PAYMENT', 'PERIOD_CLOSE', 'SALES_INVOICE', 'SALES_CREDIT_NOTE') NOT NULL;

CREATE TABLE `tax_rates` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `output_tax_account_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(120) NOT NULL,
  `rate` DECIMAL(9,4) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `tax_rates_company_id_code_key`(`company_id`, `code`),
  UNIQUE INDEX `tax_rates_id_company_id_key`(`id`, `company_id`),
  INDEX `tax_rates_company_id_is_active_idx`(`company_id`, `is_active`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_invoices` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `accounting_document_id` BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `source_invoice_id` BIGINT UNSIGNED NULL,
  `ar_journal_line_id` BIGINT UNSIGNED NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `exchange_rate` DECIMAL(19,8) NOT NULL,
  `due_date` DATE NOT NULL,
  `subtotal` DECIMAL(19,4) NOT NULL,
  `discount_total` DECIMAL(19,4) NOT NULL,
  `taxable_total` DECIMAL(19,4) NOT NULL,
  `tax_total` DECIMAL(19,4) NOT NULL,
  `total` DECIMAL(19,4) NOT NULL,
  `base_total` DECIMAL(19,4) NOT NULL,
  `customer_name_snapshot` VARCHAR(200) NOT NULL,
  `customer_tax_last4` VARCHAR(4) NULL,
  `customer_address_snapshot` VARCHAR(500) NULL,
  `notes` VARCHAR(1000) NULL,
  UNIQUE INDEX `sales_invoices_accounting_document_id_key`(`accounting_document_id`),
  UNIQUE INDEX `sales_invoices_ar_journal_line_id_key`(`ar_journal_line_id`),
  UNIQUE INDEX `sales_invoices_id_company_id_key`(`id`, `company_id`),
  UNIQUE INDEX `sales_invoices_document_company_key`(`accounting_document_id`, `company_id`),
  UNIQUE INDEX `sales_invoices_ar_line_company_key`(`ar_journal_line_id`, `company_id`),
  INDEX `sales_invoices_company_customer_due_idx`(`company_id`, `customer_id`, `due_date`),
  INDEX `sales_invoices_source_company_idx`(`source_invoice_id`, `company_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_invoice_lines` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `sales_invoice_id` BIGINT UNSIGNED NOT NULL,
  `line_number` SMALLINT UNSIGNED NOT NULL,
  `revenue_account_id` BIGINT UNSIGNED NOT NULL,
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
  UNIQUE INDEX `sales_invoice_lines_invoice_line_key`(`sales_invoice_id`, `line_number`),
  INDEX `sales_invoice_lines_company_revenue_idx`(`company_id`, `revenue_account_id`),
  INDEX `sales_invoice_lines_company_tax_idx`(`company_id`, `tax_rate_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `tax_rates`
  ADD CONSTRAINT `tax_rates_rate_chk` CHECK (`rate` >= 0 AND `rate` <= 100),
  ADD CONSTRAINT `tax_rates_name_chk` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0);

ALTER TABLE `sales_invoices`
  ADD CONSTRAINT `sales_invoices_amounts_chk` CHECK (`subtotal` >= 0 AND `discount_total` >= 0 AND `discount_total` <= `subtotal` AND `taxable_total` >= 0 AND `tax_total` >= 0 AND `total` > 0 AND `base_total` > 0 AND `exchange_rate` > 0),
  ADD CONSTRAINT `sales_invoices_name_chk` CHECK (CHAR_LENGTH(TRIM(`customer_name_snapshot`)) > 0);

ALTER TABLE `sales_invoice_lines`
  ADD CONSTRAINT `sales_invoice_lines_amounts_chk` CHECK (`quantity` > 0 AND `unit_price` >= 0 AND `discount_amount` >= 0 AND `net_amount` >= 0 AND `tax_rate_snapshot` >= 0 AND `tax_rate_snapshot` <= 100 AND `tax_amount` >= 0 AND `total_amount` > 0),
  ADD CONSTRAINT `sales_invoice_lines_description_chk` CHECK (CHAR_LENGTH(TRIM(`description`)) > 0);

ALTER TABLE `tax_rates` ADD CONSTRAINT `tax_rates_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `tax_rates` ADD CONSTRAINT `tax_rates_output_account_fkey` FOREIGN KEY (`output_tax_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_document_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_customer_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_source_fkey` FOREIGN KEY (`source_invoice_id`, `company_id`) REFERENCES `sales_invoices`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_ar_line_fkey` FOREIGN KEY (`ar_journal_line_id`, `company_id`) REFERENCES `journal_lines`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoices` ADD CONSTRAINT `sales_invoices_currency_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoice_lines` ADD CONSTRAINT `sales_invoice_lines_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoice_lines` ADD CONSTRAINT `sales_invoice_lines_invoice_fkey` FOREIGN KEY (`sales_invoice_id`, `company_id`) REFERENCES `sales_invoices`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoice_lines` ADD CONSTRAINT `sales_invoice_lines_revenue_fkey` FOREIGN KEY (`revenue_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoice_lines` ADD CONSTRAINT `sales_invoice_lines_cost_center_fkey` FOREIGN KEY (`cost_center_id`, `company_id`) REFERENCES `cost_centers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `sales_invoice_lines` ADD CONSTRAINT `sales_invoice_lines_tax_rate_fkey` FOREIGN KEY (`tax_rate_id`, `company_id`) REFERENCES `tax_rates`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('sales_invoices.view', 'sales_invoices', 'عرض فواتير المبيعات والإشعارات الدائنة'),
  ('sales_invoices.create', 'sales_invoices', 'إنشاء فواتير المبيعات والإشعارات الدائنة'),
  ('sales_invoices.update', 'sales_invoices', 'تعديل فواتير المبيعات والإشعارات الدائنة'),
  ('sales_invoices.post', 'sales_invoices', 'ترحيل فواتير المبيعات والإشعارات الدائنة'),
  ('sales_invoices.cancel', 'sales_invoices', 'إلغاء مسودات فواتير المبيعات'),
  ('sales_invoices.reverse', 'sales_invoices', 'عكس فواتير المبيعات المرحلة'),
  ('tax_rates.manage', 'sales_invoices', 'إدارة نسب ضريبة المبيعات'),
  ('reports.receivables.view', 'reports', 'عرض أرصدة العملاء وأعمار الديون')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'sales_invoices.view', 'sales_invoices.create', 'sales_invoices.update',
  'sales_invoices.post', 'sales_invoices.cancel', 'sales_invoices.reverse',
  'tax_rates.manage', 'reports.receivables.view'
)
WHERE `roles`.`code` = 'ADMINISTRATOR';
