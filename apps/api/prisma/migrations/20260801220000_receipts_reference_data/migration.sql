-- CreateTable
CREATE TABLE `customers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `receivable_account_id` BIGINT UNSIGNED NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(200) NOT NULL,
    `name_en` VARCHAR(200) NULL,
    `phone` VARCHAR(40) NULL,
    `email` VARCHAR(320) NULL,
    `tax_number_last4` VARCHAR(4) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `customers_company_id_name_ar_idx`(`company_id`, `name_ar`),
    UNIQUE INDEX `customers_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `customers_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customers` ADD CONSTRAINT `customers_text_chk` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0);

-- CreateTable
CREATE TABLE `customer_addresses` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `customer_id` BIGINT UNSIGNED NOT NULL,
    `address_type` ENUM('LEGAL', 'BILLING', 'OTHER') NOT NULL,
    `line1` VARCHAR(200) NOT NULL,
    `line2` VARCHAR(200) NULL,
    `city` VARCHAR(100) NULL,
    `region` VARCHAR(100) NULL,
    `postal_code` VARCHAR(20) NULL,
    `country_code` CHAR(2) NULL,
    `is_primary` BOOLEAN NOT NULL DEFAULT false,

    INDEX `customer_addresses_customer_id_company_id_idx`(`customer_id`, `company_id`),
    UNIQUE INDEX `customer_addresses_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_line1_chk` CHECK (CHAR_LENGTH(TRIM(`line1`)) > 0);

-- CreateTable
CREATE TABLE `cash_bank_accounts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `ledger_account_id` BIGINT UNSIGNED NOT NULL,
    `account_type` ENUM('CASH', 'BANK') NOT NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(160) NOT NULL,
    `name_en` VARCHAR(160) NULL,
    `bank_name` VARCHAR(160) NULL,
    `account_number_last4` VARCHAR(4) NULL,
    `iban_last4` VARCHAR(4) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `cash_bank_accounts_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `cash_bank_accounts_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cash_bank_accounts` ADD CONSTRAINT `cash_bank_accounts_text_chk` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0);

-- CreateTable
CREATE TABLE `payment_methods` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(120) NOT NULL,
    `requires_reference` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `scope` ENUM('GLOBAL', 'COMPANY') NOT NULL DEFAULT 'GLOBAL',

    UNIQUE INDEX `payment_methods_code_key`(`code`),
    INDEX `payment_methods_company_id_is_active_idx`(`company_id`, `is_active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `payment_methods`
  ADD CONSTRAINT `payment_methods_text_chk` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0 AND CHAR_LENGTH(TRIM(`name_ar`)) > 0),
  ADD CONSTRAINT `payment_methods_scope_chk` CHECK ((`scope` = 'GLOBAL' AND `company_id` IS NULL) OR (`scope` = 'COMPANY' AND `company_id` IS NOT NULL));

-- CreateTable
CREATE TABLE `receipts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `accounting_document_id` BIGINT UNSIGNED NOT NULL,
    `customer_id` BIGINT UNSIGNED NULL,
    `counter_account_id` BIGINT UNSIGNED NULL,
    `cash_bank_account_id` BIGINT UNSIGNED NOT NULL,
    `payment_method_id` BIGINT UNSIGNED NOT NULL,
    `currency_id` BIGINT UNSIGNED NOT NULL,
    `exchange_rate` DECIMAL(19, 8) NOT NULL,
    `amount` DECIMAL(19, 4) NOT NULL,
    `base_amount` DECIMAL(19, 4) NOT NULL,
    `reference_number` VARCHAR(100) NULL,
    `counterparty_name_snapshot` VARCHAR(200) NOT NULL,
    `counterparty_tax_last4` VARCHAR(4) NULL,
    `counterparty_address_snapshot` VARCHAR(500) NULL,
    `notes` VARCHAR(1000) NULL,

    UNIQUE INDEX `receipts_accounting_document_id_key`(`accounting_document_id`),
    INDEX `receipts_company_id_customer_id_idx`(`company_id`, `customer_id`),
    UNIQUE INDEX `receipts_id_company_id_key`(`id`, `company_id`),
    UNIQUE INDEX `receipts_accounting_document_id_company_id_key`(`accounting_document_id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `receipts`
  ADD CONSTRAINT `receipts_counterparty_xor_chk` CHECK ((`customer_id` IS NULL) <> (`counter_account_id` IS NULL)),
  ADD CONSTRAINT `receipts_amount_chk` CHECK (`amount` > 0 AND `base_amount` > 0 AND `exchange_rate` > 0),
  ADD CONSTRAINT `receipts_counterparty_name_chk` CHECK (CHAR_LENGTH(TRIM(`counterparty_name_snapshot`)) > 0);

-- CreateTable
CREATE TABLE `receipt_allocations` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `receipt_id` BIGINT UNSIGNED NOT NULL,
    `target_journal_line_id` BIGINT UNSIGNED NOT NULL,
    `allocated_amount` DECIMAL(19, 4) NOT NULL,

    INDEX `receipt_allocations_company_id_target_journal_line_id_idx`(`company_id`, `target_journal_line_id`),
    UNIQUE INDEX `receipt_allocations_receipt_id_target_journal_line_id_key`(`receipt_id`, `target_journal_line_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_amount_chk` CHECK (`allocated_amount` > 0);

-- CreateIndex
CREATE UNIQUE INDEX `journal_lines_id_company_id_key` ON `journal_lines`(`id`, `company_id`);

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_customer_id_company_id_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customers` ADD CONSTRAINT `customers_receivable_account_id_company_id_fkey` FOREIGN KEY (`receivable_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `customer_addresses` ADD CONSTRAINT `customer_addresses_customer_id_company_id_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_accounts` ADD CONSTRAINT `cash_bank_accounts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cash_bank_accounts` ADD CONSTRAINT `cash_bank_accounts_ledger_account_id_company_id_fkey` FOREIGN KEY (`ledger_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `payment_methods` ADD CONSTRAINT `payment_methods_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_accounting_document_id_company_id_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_customer_id_company_id_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_counter_account_id_company_id_fkey` FOREIGN KEY (`counter_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_cash_bank_account_id_company_id_fkey` FOREIGN KEY (`cash_bank_account_id`, `company_id`) REFERENCES `cash_bank_accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_payment_method_id_fkey` FOREIGN KEY (`payment_method_id`) REFERENCES `payment_methods`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipts` ADD CONSTRAINT `receipts_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_receipt_id_company_id_fkey` FOREIGN KEY (`receipt_id`, `company_id`) REFERENCES `receipts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `receipt_allocations` ADD CONSTRAINT `receipt_allocations_target_journal_line_id_company_id_fkey` FOREIGN KEY (`target_journal_line_id`, `company_id`) REFERENCES `journal_lines`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
