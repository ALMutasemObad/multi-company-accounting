-- AlterTable
ALTER TABLE `permissions`
    ADD COLUMN `description_ar` VARCHAR(255) NULL,
    ADD COLUMN `module` VARCHAR(80) NULL;

UPDATE `permissions`
SET `module` = SUBSTRING_INDEX(`code`, '.', 1),
    `description_ar` = COALESCE(`description`, `code`);

ALTER TABLE `permissions`
    DROP COLUMN `description`,
    MODIFY `description_ar` VARCHAR(255) NOT NULL,
    MODIFY `module` VARCHAR(80) NOT NULL;

-- AlterTable
ALTER TABLE `roles` ADD COLUMN `is_system_role` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `name_en` VARCHAR(120) NULL;

-- AlterTable
ALTER TABLE `users` ADD COLUMN `last_login_at` DATETIME(3) NULL,
    ADD COLUMN `name_en` VARCHAR(160) NULL;

-- CreateTable
CREATE TABLE `audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `company_id` BIGINT UNSIGNED NOT NULL,
    `actor_user_id` BIGINT UNSIGNED NOT NULL,
    `action` VARCHAR(120) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `audit_logs_company_id_created_at_idx`(`company_id`, `created_at`),
    INDEX `audit_logs_actor_user_id_idx`(`actor_user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `audit_logs` ADD CONSTRAINT `audit_logs_actor_user_id_fkey` FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
