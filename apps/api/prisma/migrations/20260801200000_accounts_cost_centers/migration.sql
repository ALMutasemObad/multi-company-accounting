-- CreateTable
CREATE TABLE `account_types` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(120) NOT NULL,
    `class` ENUM('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE') NOT NULL,
    `normal_balance` ENUM('DEBIT', 'CREDIT') NOT NULL,
    `statement_section` ENUM('BALANCE_SHEET', 'INCOME_STATEMENT') NULL,

    UNIQUE INDEX `account_types_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `account_types`
  ADD CONSTRAINT `account_types_code_nonempty` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
  ADD CONSTRAINT `account_types_name_ar_nonempty` CHECK (CHAR_LENGTH(TRIM(`name_ar`)) > 0);

-- CreateTable
CREATE TABLE `accounts` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `account_type_id` BIGINT UNSIGNED NOT NULL,
    `parent_account_id` BIGINT UNSIGNED NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(180) NOT NULL,
    `name_en` VARCHAR(180) NULL,
    `level` TINYINT UNSIGNED NOT NULL,
    `allows_posting` BOOLEAN NOT NULL,
    `is_control_account` BOOLEAN NOT NULL DEFAULT false,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `accounts_parent_account_id_company_id_idx`(`parent_account_id`, `company_id`),
    UNIQUE INDEX `accounts_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `accounts_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `accounts`
  ADD CONSTRAINT `accounts_code_nonempty` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
  ADD CONSTRAINT `accounts_name_ar_nonempty` CHECK (CHAR_LENGTH(TRIM(`name_ar`)) > 0),
  ADD CONSTRAINT `accounts_level_range` CHECK (`level` BETWEEN 1 AND 20);

-- CreateTable
CREATE TABLE `cost_centers` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `parent_id` BIGINT UNSIGNED NULL,
    `code` VARCHAR(40) NOT NULL,
    `name_ar` VARCHAR(160) NOT NULL,
    `name_en` VARCHAR(160) NULL,
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `cost_centers_parent_id_company_id_idx`(`parent_id`, `company_id`),
    UNIQUE INDEX `cost_centers_company_id_code_key`(`company_id`, `code`),
    UNIQUE INDEX `cost_centers_id_company_id_key`(`id`, `company_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `cost_centers`
  ADD CONSTRAINT `cost_centers_code_nonempty` CHECK (CHAR_LENGTH(TRIM(`code`)) > 0),
  ADD CONSTRAINT `cost_centers_name_ar_nonempty` CHECK (CHAR_LENGTH(TRIM(`name_ar`)) > 0);

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_account_id_company_id_fkey` FOREIGN KEY (`account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `journal_lines` ADD CONSTRAINT `journal_lines_cost_center_id_company_id_fkey` FOREIGN KEY (`cost_center_id`, `company_id`) REFERENCES `cost_centers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_account_type_id_fkey` FOREIGN KEY (`account_type_id`) REFERENCES `account_types`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `accounts` ADD CONSTRAINT `accounts_parent_account_id_company_id_fkey` FOREIGN KEY (`parent_account_id`, `company_id`) REFERENCES `accounts`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_centers` ADD CONSTRAINT `cost_centers_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `cost_centers` ADD CONSTRAINT `cost_centers_parent_id_company_id_fkey` FOREIGN KEY (`parent_id`, `company_id`) REFERENCES `cost_centers`(`id`, `company_id`) ON DELETE RESTRICT ON UPDATE CASCADE;
