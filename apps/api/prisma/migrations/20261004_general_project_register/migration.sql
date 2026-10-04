-- Independent general project register. The module is deliberately dark until API/UI acceptance.
CREATE TABLE `general_projects` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `customer_id` BIGINT UNSIGNED NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `description` VARCHAR(1000) NULL,
  `status` ENUM('DRAFT', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `planned_start_date` DATE NULL,
  `target_end_date` DATE NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `plan_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `general_projects_public_id_key` (`public_id`),
  UNIQUE KEY `general_projects_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `general_projects_id_company_key` (`id`, `company_id`),
  KEY `general_projects_company_status_created_idx` (`company_id`, `status`, `created_at`, `id`),
  KEY `general_projects_company_priority_created_idx` (`company_id`, `priority`, `created_at`, `id`),
  KEY `general_projects_customer_company_status_idx` (`customer_id`, `company_id`, `status`),
  CONSTRAINT `general_projects_dates_chk` CHECK (`planned_start_date` IS NULL OR `target_end_date` IS NULL OR `target_end_date` >= `planned_start_date`),
  CONSTRAINT `general_projects_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_projects_customer_company_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_projects_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_projects_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `general_project_members` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `role` ENUM('MANAGER', 'CONTRIBUTOR') NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `assigned_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `unassigned_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `general_project_members_public_id_key` (`public_id`),
  UNIQUE KEY `general_project_members_project_employee_key` (`project_id`, `employee_id`),
  UNIQUE KEY `general_project_members_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `general_project_members_id_project_company_key` (`id`, `project_id`, `company_id`),
  KEY `general_project_members_company_employee_active_idx` (`company_id`, `employee_id`, `is_active`),
  KEY `general_project_members_project_active_role_idx` (`project_id`, `is_active`, `role`),
  CONSTRAINT `general_project_members_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_project_members_project_company_fkey` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `general_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_project_members_employee_company_fkey` FOREIGN KEY (`employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_project_members_assigned_by_fkey` FOREIGN KEY (`assigned_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `general_project_members_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `platform_modules` (`code`, `display_name`, `is_active`, `version`, `updated_at`)
VALUES ('GENERAL_PROJECTS', 'Project management', FALSE, 0, CURRENT_TIMESTAMP(3));

INSERT INTO `platform_module_dependencies` (`module_id`, `depends_on_module_id`)
SELECT module_row.`id`, hr_row.`id`
FROM `platform_modules` module_row
JOIN `platform_modules` hr_row ON hr_row.`code` = 'HUMAN_RESOURCES'
WHERE module_row.`code` = 'GENERAL_PROJECTS';

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, 'GENERAL_PROJECT', 'GPR-', 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
ON DUPLICATE KEY UPDATE `prefix` = VALUES(`prefix`), `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('general_projects.view', 'general_projects', 'عرض إدارة المشاريع'),
  ('general_projects.manage', 'general_projects', 'إنشاء وإدارة المشاريع وفريقها')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('general_projects.view', 'general_projects.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
