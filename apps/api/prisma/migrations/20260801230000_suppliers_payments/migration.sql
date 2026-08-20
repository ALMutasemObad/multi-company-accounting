-- Extend the shared address type for supplier payment addresses.
ALTER TABLE `customer_addresses` MODIFY `address_type` ENUM('LEGAL', 'BILLING', 'PAYMENT', 'OTHER') NOT NULL;

CREATE TABLE `suppliers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `payable_account_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(320) NULL,
  `tax_number_last4` VARCHAR(4) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT true,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  INDEX `suppliers_company_id_name_ar_idx`(`company_id`, `name_ar`),
  UNIQUE INDEX `suppliers_company_id_code_key`(`company_id`, `code`),
  UNIQUE INDEX `suppliers_id_company_id_key`(`id`, `company_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_text_chk` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0);

CREATE TABLE `supplier_addresses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NOT NULL,
  `address_type` ENUM('LEGAL', 'BILLING', 'PAYMENT', 'OTHER') NOT NULL,
  `line1` VARCHAR(200) NOT NULL,
  `line2` VARCHAR(200) NULL,
  `city` VARCHAR(100) NULL,
  `region` VARCHAR(100) NULL,
  `postal_code` VARCHAR(20) NULL,
  `country_code` CHAR(2) NULL,
  `is_primary` BOOLEAN NOT NULL DEFAULT false,
  INDEX `supplier_addresses_supplier_id_company_id_idx`(`supplier_id`, `company_id`),
  UNIQUE INDEX `supplier_addresses_id_company_id_key`(`id`, `company_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `supplier_addresses` ADD CONSTRAINT `supplier_addresses_line1_chk` CHECK (CHAR_LENGTH(TRIM(`line1`)) > 0);

CREATE TABLE `payments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `accounting_document_id` BIGINT UNSIGNED NOT NULL,
  `supplier_id` BIGINT UNSIGNED NULL,
  `counter_account_id` BIGINT UNSIGNED NULL,
  `cash_bank_account_id` BIGINT UNSIGNED NOT NULL,
  `payment_method_id` BIGINT UNSIGNED NOT NULL,
  `currency_id` BIGINT UNSIGNED NOT NULL,
  `exchange_rate` DECIMAL(19,8) NOT NULL,
  `amount` DECIMAL(19,4) NOT NULL,
  `base_amount` DECIMAL(19,4) NOT NULL,
  `reference_number` VARCHAR(100) NULL,
  `counterparty_name_snapshot` VARCHAR(200) NOT NULL,
  `counterparty_tax_last4` VARCHAR(4) NULL,
  `counterparty_address_snapshot` VARCHAR(500) NULL,
  `notes` VARCHAR(1000) NULL,
  UNIQUE INDEX `payments_accounting_document_id_key`(`accounting_document_id`),
  INDEX `payments_company_id_supplier_id_idx`(`company_id`, `supplier_id`),
  UNIQUE INDEX `payments_id_company_id_key`(`id`, `company_id`),
  UNIQUE INDEX `payments_accounting_document_id_company_id_key`(`accounting_document_id`, `company_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `payments`
  ADD CONSTRAINT `payments_counterparty_xor_chk` CHECK ((`supplier_id` IS NULL) <> (`counter_account_id` IS NULL)),
  ADD CONSTRAINT `payments_amount_chk` CHECK (`amount` > 0 AND `base_amount` > 0 AND `exchange_rate` > 0),
  ADD CONSTRAINT `payments_counterparty_name_chk` CHECK (CHAR_LENGTH(TRIM(`counterparty_name_snapshot`)) > 0);

CREATE TABLE `payment_allocations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `payment_id` BIGINT UNSIGNED NOT NULL,
  `target_journal_line_id` BIGINT UNSIGNED NOT NULL,
  `allocated_amount` DECIMAL(19,4) NOT NULL,
  INDEX `payment_allocations_company_id_target_journal_line_id_idx`(`company_id`, `target_journal_line_id`),
  UNIQUE INDEX `payment_allocations_payment_id_target_journal_line_id_key`(`payment_id`, `target_journal_line_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_amount_chk` CHECK (`allocated_amount` > 0);

ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_supplier_id_company_id_fkey` FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_payable_account_id_company_id_fkey` FOREIGN KEY (`payable_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `supplier_addresses` ADD CONSTRAINT `supplier_addresses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `supplier_addresses` ADD CONSTRAINT `supplier_addresses_supplier_id_company_id_fkey` FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_accounting_document_id_company_id_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_supplier_id_company_id_fkey` FOREIGN KEY (`supplier_id`, `company_id`) REFERENCES `suppliers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payments` ADD CONSTRAINT `payments_counter_account_id_company_id_fkey` FOREIGN KEY (`counter_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE `payments` ADD CONSTRAINT `payments_cash_bank_account_id_company_id_fkey` FOREIGN KEY (`cash_bank_account_id`, `company_id`) REFERENCES `cash_bank_accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_payment_method_id_fkey` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payments` ADD CONSTRAINT `payments_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_payment_id_company_id_fkey` FOREIGN KEY (`payment_id`, `company_id`) REFERENCES `payments`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `payment_allocations` ADD CONSTRAINT `payment_allocations_target_journal_line_id_company_id_fkey` FOREIGN KEY (`target_journal_line_id`, `company_id`) REFERENCES `journal_lines`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
