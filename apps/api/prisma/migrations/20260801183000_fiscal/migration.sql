-- CreateTable
CREATE TABLE `fiscal_years` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('OPEN', 'CLOSED') NOT NULL DEFAULT 'OPEN',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fiscal_years_company_id_start_date_end_date_idx`(`company_id`, `start_date`, `end_date`),
    UNIQUE INDEX `fiscal_years_company_id_name_key`(`company_id`, `name`),
    UNIQUE INDEX `fiscal_years_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `fiscal_periods` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `fiscal_year_id` BIGINT UNSIGNED NOT NULL,
    `period_number` TINYINT UNSIGNED NOT NULL,
    `name` VARCHAR(80) NOT NULL,
    `start_date` DATE NOT NULL,
    `end_date` DATE NOT NULL,
    `status` ENUM('OPEN', 'CLOSED', 'REOPENED') NOT NULL DEFAULT 'OPEN',
    `closed_by` BIGINT UNSIGNED NULL,
    `closed_at` DATETIME(3) NULL,
    `reopened_by` BIGINT UNSIGNED NULL,
    `reopened_at` DATETIME(3) NULL,
    `reopen_reason` VARCHAR(500) NULL,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `fiscal_periods_company_id_start_date_end_date_idx`(`company_id`, `start_date`, `end_date`),
    UNIQUE INDEX `fiscal_periods_fiscal_year_id_period_number_key`(`fiscal_year_id`, `period_number`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `document_sequences` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `fiscal_year_id` BIGINT UNSIGNED NOT NULL,
    `document_type` VARCHAR(40) NOT NULL,
    `prefix` VARCHAR(20) NOT NULL,
    `next_number` BIGINT UNSIGNED NOT NULL DEFAULT 1,
    `padding` TINYINT UNSIGNED NOT NULL DEFAULT 6,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `document_sequences_company_id_fiscal_year_id_idx`(`company_id`, `fiscal_year_id`),
    UNIQUE INDEX `document_sequences_fiscal_year_id_document_type_key`(`fiscal_year_id`, `document_type`),
    UNIQUE INDEX `document_sequences_company_id_document_type_prefix_key`(`company_id`, `document_type`, `prefix`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `fiscal_years` ADD CONSTRAINT `fiscal_years_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_fiscal_year_id_company_id_fkey` FOREIGN KEY (`fiscal_year_id`, `company_id`) REFERENCES `fiscal_years`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_closed_by_fkey` FOREIGN KEY (`closed_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `fiscal_periods` ADD CONSTRAINT `fiscal_periods_reopened_by_fkey` FOREIGN KEY (`reopened_by`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE `document_sequences` ADD CONSTRAINT `document_sequences_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `document_sequences` ADD CONSTRAINT `document_sequences_fiscal_year_id_company_id_fkey` FOREIGN KEY (`fiscal_year_id`, `company_id`) REFERENCES `fiscal_years`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE `fiscal_years`
  ADD CONSTRAINT `fiscal_years_date_range_chk` CHECK (`end_date` >= `start_date`);

ALTER TABLE `fiscal_periods`
  ADD CONSTRAINT `fiscal_periods_date_range_chk` CHECK (`end_date` >= `start_date`),
  ADD CONSTRAINT `fiscal_periods_state_metadata_chk` CHECK (
    (`status` = 'OPEN' AND `closed_by` IS NULL AND `closed_at` IS NULL AND `reopened_by` IS NULL AND `reopened_at` IS NULL AND `reopen_reason` IS NULL)
    OR (`status` = 'CLOSED' AND `closed_by` IS NOT NULL AND `closed_at` IS NOT NULL)
    OR (`status` = 'REOPENED' AND `closed_by` IS NOT NULL AND `closed_at` IS NOT NULL AND `reopened_by` IS NOT NULL AND `reopened_at` IS NOT NULL AND CHAR_LENGTH(`reopen_reason`) >= 10)
  );

ALTER TABLE `document_sequences`
  ADD CONSTRAINT `document_sequences_values_chk` CHECK (`prefix` <> '' AND `next_number` >= 1 AND `padding` BETWEEN 1 AND 12);
