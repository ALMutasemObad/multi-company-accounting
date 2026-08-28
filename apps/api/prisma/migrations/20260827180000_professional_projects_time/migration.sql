CREATE TABLE `professional_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `kind` ENUM('LEGAL_MATTER', 'CONSULTING_ENGAGEMENT', 'PROFESSIONAL_PROJECT') NOT NULL,
  `billing_model` ENUM('TIME_AND_MATERIALS', 'FIXED_FEE', 'NON_BILLABLE') NOT NULL,
  `status` ENUM('ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'ACTIVE',
  `start_date` DATE NOT NULL,
  `target_end_date` DATE NULL,
  `description` VARCHAR(1000) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_projects_public_id_key` (`public_id`),
  UNIQUE KEY `professional_projects_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `professional_projects_id_company_key` (`id`, `company_id`),
  KEY `professional_projects_company_status_created_idx` (`company_id`, `status`, `created_at`),
  KEY `professional_projects_customer_company_status_idx` (`customer_id`, `company_id`, `status`),
  CONSTRAINT `professional_projects_dates_chk` CHECK (`target_end_date` IS NULL OR `target_end_date` >= `start_date`),
  CONSTRAINT `professional_projects_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_projects_customer_company_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_projects_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_projects_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_project_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `role` ENUM('MANAGER', 'PROFESSIONAL', 'REVIEWER') NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `assigned_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `unassigned_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_project_members_project_user_key` (`project_id`, `user_id`),
  UNIQUE KEY `professional_project_members_project_user_company_key` (`project_id`, `user_id`, `company_id`),
  UNIQUE KEY `professional_project_members_id_company_key` (`id`, `company_id`),
  KEY `professional_project_members_company_user_active_idx` (`company_id`, `user_id`, `is_active`),
  KEY `professional_project_members_project_active_role_idx` (`project_id`, `is_active`, `role`),
  CONSTRAINT `professional_project_members_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_members_project_company_fkey` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_members_assignment_fkey` FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_members_assigned_by_fkey` FOREIGN KEY (`assigned_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_members_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_time_entries` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `work_date` DATE NOT NULL,
  `minutes` SMALLINT UNSIGNED NOT NULL,
  `is_billable` BOOLEAN NOT NULL DEFAULT TRUE,
  `description` VARCHAR(1000) NOT NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_time_entries_public_id_key` (`public_id`),
  UNIQUE KEY `professional_time_entries_id_company_key` (`id`, `company_id`),
  KEY `professional_time_entries_company_work_date_id_idx` (`company_id`, `work_date`, `id`),
  KEY `professional_time_entries_project_work_date_id_idx` (`project_id`, `work_date`, `id`),
  KEY `professional_time_entries_company_user_work_date_idx` (`company_id`, `user_id`, `work_date`),
  CONSTRAINT `professional_time_entries_minutes_chk` CHECK (`minutes` BETWEEN 1 AND 1440),
  CONSTRAINT `professional_time_entries_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_time_entries_member_fkey` FOREIGN KEY (`project_id`, `user_id`, `company_id`) REFERENCES `professional_project_members` (`project_id`, `user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'PROFESSIONAL_PROJECT', 'PRJ-', 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
ON DUPLICATE KEY UPDATE `prefix` = VALUES(`prefix`), `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('professional_projects.view', 'professional_projects', 'عرض المشاريع والقضايا المهنية'),
  ('professional_projects.manage', 'professional_projects', 'إدارة المشاريع والقضايا المهنية وأعضائها'),
  ('professional_time.view', 'professional_projects', 'عرض سجلات الوقت المهنية'),
  ('professional_time.log', 'professional_projects', 'تسجيل الوقت المهني وتعديل السجل الشخصي')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'professional_projects.view',
  'professional_projects.manage',
  'professional_time.view',
  'professional_time.log'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
