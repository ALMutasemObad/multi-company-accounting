-- CreateTable
CREATE TABLE `journal_entries` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `accounting_document_id` BIGINT UNSIGNED NOT NULL,
    `entry_number` SMALLINT UNSIGNED NOT NULL,
    `entry_date` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `reversal_of_journal_entry_id` BIGINT UNSIGNED NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `journal_entries_reversal_of_journal_entry_id_key`(`reversal_of_journal_entry_id`),
    INDEX `journal_entries_company_id_entry_date_idx`(`company_id`, `entry_date`),
    UNIQUE INDEX `journal_entries_accounting_document_id_entry_number_key`(`accounting_document_id`, `entry_number`),
    UNIQUE INDEX `journal_entries_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `journal_lines` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `journal_entry_id` BIGINT UNSIGNED NOT NULL,
    `line_number` SMALLINT UNSIGNED NOT NULL,
    `account_id` BIGINT UNSIGNED NOT NULL,
    `cost_center_id` BIGINT UNSIGNED NULL,
    `customer_id` BIGINT UNSIGNED NULL,
    `supplier_id` BIGINT UNSIGNED NULL,
    `description` VARCHAR(500) NULL,
    `currency_id` BIGINT UNSIGNED NOT NULL,
    `exchange_rate` DECIMAL(19, 8) NOT NULL DEFAULT 1,
    `debit_amount` DECIMAL(19, 4) NOT NULL,
    `credit_amount` DECIMAL(19, 4) NOT NULL,
    `base_debit_amount` DECIMAL(19, 4) NOT NULL,
    `base_credit_amount` DECIMAL(19, 4) NOT NULL,

    INDEX `journal_lines_company_id_account_id_idx`(`company_id`, `account_id`),
    INDEX `journal_lines_company_id_customer_id_idx`(`company_id`, `customer_id`),
    INDEX `journal_lines_company_id_supplier_id_idx`(`company_id`, `supplier_id`),
    UNIQUE INDEX `journal_lines_journal_entry_id_line_number_key`(`journal_entry_id`, `line_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `accounting_documents_id_company_id_key` ON `accounting_documents`(`id`, `company_id`);

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_accounting_document_id_company_id_fkey` FOREIGN KEY (`accounting_document_id`, `company_id`) REFERENCES `accounting_documents`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_entries` ADD CONSTRAINT `journal_entries_reversal_of_journal_entry_id_fkey` FOREIGN KEY (`reversal_of_journal_entry_id`) REFERENCES `journal_entries`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_journal_entry_id_company_id_fkey` FOREIGN KEY (`journal_entry_id`, `company_id`) REFERENCES `journal_entries`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_currency_id_fkey` FOREIGN KEY (`currency_id`) REFERENCES `currencies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `journal_entries`
  ADD CONSTRAINT `journal_entries_values_chk` CHECK (`entry_number` > 0 AND CHAR_LENGTH(TRIM(`description`)) > 0);

ALTER TABLE `journal_lines`
  ADD CONSTRAINT `journal_lines_values_chk` CHECK (
    `line_number` > 0 AND `exchange_rate` > 0
    AND `debit_amount` >= 0 AND `credit_amount` >= 0
    AND `base_debit_amount` >= 0 AND `base_credit_amount` >= 0
    AND ((`debit_amount` > 0 AND `credit_amount` = 0 AND `base_debit_amount` > 0 AND `base_credit_amount` = 0)
      OR (`credit_amount` > 0 AND `debit_amount` = 0 AND `base_credit_amount` > 0 AND `base_debit_amount` = 0))
  );
