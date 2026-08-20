-- CreateTable
CREATE TABLE `accounting_documents` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `fiscal_period_id` BIGINT UNSIGNED NOT NULL,
    `document_type` ENUM('MANUAL_JOURNAL', 'RECEIPT', 'PAYMENT', 'PERIOD_CLOSE') NOT NULL,
    `document_number` VARCHAR(60) NOT NULL,
    `document_date` DATE NOT NULL,
    `description` VARCHAR(500) NOT NULL,
    `status` ENUM('DRAFT', 'POSTED', 'REVERSED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
    `created_by` BIGINT UNSIGNED NOT NULL,
    `posted_by` BIGINT UNSIGNED NULL,
    `posted_at` DATETIME(3) NULL,
    `reversed_by_document_id` BIGINT UNSIGNED NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `accounting_documents_reversed_by_document_id_key`(`reversed_by_document_id`),
    INDEX `accounting_documents_company_id_document_date_status_idx`(`company_id`, `document_date`, `status`),
    INDEX `accounting_documents_fiscal_period_id_status_idx`(`fiscal_period_id`, `status`),
    UNIQUE INDEX `accounting_documents_company_id_document_type_document_numbe_key`(`company_id`, `document_type`, `document_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `fiscal_periods_id_company_id_key` ON `fiscal_periods`(`id`, `company_id`);

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_fiscal_period_id_company_id_fkey` FOREIGN KEY (`fiscal_period_id`, `company_id`) REFERENCES `fiscal_periods`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_created_by_fkey` FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_posted_by_fkey` FOREIGN KEY (`posted_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `accounting_documents` ADD CONSTRAINT `accounting_documents_reversed_by_document_id_fkey` FOREIGN KEY (`reversed_by_document_id`) REFERENCES `accounting_documents`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `accounting_documents`
  ADD CONSTRAINT `accounting_documents_description_chk` CHECK (CHAR_LENGTH(TRIM(`description`)) > 0),
  ADD CONSTRAINT `accounting_documents_status_metadata_chk` CHECK (
    (`status` IN ('DRAFT','CANCELLED') AND `posted_by` IS NULL AND `posted_at` IS NULL AND `reversed_by_document_id` IS NULL)
    OR (`status` = 'POSTED' AND `posted_by` IS NOT NULL AND `posted_at` IS NOT NULL AND `reversed_by_document_id` IS NULL)
    OR (`status` = 'REVERSED' AND `posted_by` IS NOT NULL AND `posted_at` IS NOT NULL AND `reversed_by_document_id` IS NOT NULL)
  );
