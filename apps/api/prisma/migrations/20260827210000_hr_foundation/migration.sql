CREATE TABLE `hr_departments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(160) NOT NULL,
  `name_en` VARCHAR(160) NULL,
  `description` VARCHAR(500) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `hr_departments_public_id_key` (`public_id`),
  UNIQUE KEY `hr_departments_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `hr_departments_id_company_key` (`id`, `company_id`),
  KEY `hr_departments_company_active_name_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `hr_departments_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `hr_departments_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `hr_departments_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `hr_positions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(160) NOT NULL,
  `name_en` VARCHAR(160) NULL,
  `description` VARCHAR(500) NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `hr_positions_public_id_key` (`public_id`),
  UNIQUE KEY `hr_positions_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `hr_positions_id_company_key` (`id`, `company_id`),
  KEY `hr_positions_company_active_name_idx` (`company_id`, `is_active`, `name_ar`),
  CONSTRAINT `hr_positions_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `hr_positions_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `hr_positions_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employees` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NULL,
  `department_id` BIGINT UNSIGNED NULL,
  `position_id` BIGINT UNSIGNED NULL,
  `manager_employee_id` BIGINT UNSIGNED NULL,
  `employee_number` VARCHAR(40) NOT NULL,
  `name_ar` VARCHAR(160) NOT NULL,
  `name_en` VARCHAR(160) NULL,
  `employment_type` ENUM('FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'INTERN') NOT NULL,
  `status` ENUM('ACTIVE', 'ON_LEAVE', 'TERMINATED') NOT NULL DEFAULT 'ACTIVE',
  `hire_date` DATE NOT NULL,
  `termination_date` DATE NULL,
  `termination_reason` VARCHAR(500) NULL,
  `work_location` VARCHAR(160) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employees_public_id_key` (`public_id`),
  UNIQUE KEY `employees_company_number_key` (`company_id`, `employee_number`),
  UNIQUE KEY `employees_user_company_key` (`user_id`, `company_id`),
  UNIQUE KEY `employees_id_company_key` (`id`, `company_id`),
  KEY `employees_company_status_name_idx` (`company_id`, `status`, `name_ar`),
  KEY `employees_department_company_status_idx` (`department_id`, `company_id`, `status`),
  KEY `employees_position_company_status_idx` (`position_id`, `company_id`, `status`),
  KEY `employees_manager_company_status_idx` (`manager_employee_id`, `company_id`, `status`),
  CONSTRAINT `employees_termination_chk` CHECK (
    (`status` = 'TERMINATED' AND `termination_date` IS NOT NULL AND `termination_reason` IS NOT NULL AND `termination_date` >= `hire_date`)
    OR (`status` <> 'TERMINATED' AND `termination_date` IS NULL AND `termination_reason` IS NULL)
  ),
  CONSTRAINT `employees_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_identity_assignment_fkey` FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_department_company_fkey` FOREIGN KEY (`department_id`, `company_id`) REFERENCES `hr_departments` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_position_company_fkey` FOREIGN KEY (`position_id`, `company_id`) REFERENCES `hr_positions` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_manager_company_fkey` FOREIGN KEY (`manager_employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employees_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `employment_contracts` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `employee_id` BIGINT UNSIGNED NOT NULL,
  `contract_type` ENUM('PERMANENT', 'FIXED_TERM', 'CONSULTANT', 'INTERNSHIP') NOT NULL,
  `title_ar` VARCHAR(200) NOT NULL,
  `title_en` VARCHAR(200) NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NULL,
  `status` ENUM('ACTIVE', 'ENDED') NOT NULL DEFAULT 'ACTIVE',
  `notes` VARCHAR(1000) NULL,
  `end_reason` VARCHAR(500) NULL,
  `ended_at` DATETIME(3) NULL,
  `ended_by_id` BIGINT UNSIGNED NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `employment_contracts_public_id_key` (`public_id`),
  UNIQUE KEY `employment_contracts_id_company_key` (`id`, `company_id`),
  KEY `employment_contracts_employee_company_status_start_idx` (`employee_id`, `company_id`, `status`, `start_date`),
  KEY `employment_contracts_company_status_end_idx` (`company_id`, `status`, `end_date`),
  CONSTRAINT `employment_contracts_dates_chk` CHECK (`end_date` IS NULL OR `end_date` >= `start_date`),
  CONSTRAINT `employment_contracts_end_state_chk` CHECK (
    (`status` = 'ACTIVE' AND `ended_at` IS NULL AND `ended_by_id` IS NULL AND `end_reason` IS NULL)
    OR (`status` = 'ENDED' AND `end_date` IS NOT NULL AND `ended_at` IS NOT NULL AND `ended_by_id` IS NOT NULL AND `end_reason` IS NOT NULL)
  ),
  CONSTRAINT `employment_contracts_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employment_contracts_employee_company_fkey` FOREIGN KEY (`employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employment_contracts_ended_by_fkey` FOREIGN KEY (`ended_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employment_contracts_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `employment_contracts_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, `types`.`entity_type`, `types`.`prefix`, 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
CROSS JOIN (
  SELECT 'HR_DEPARTMENT' AS `entity_type`, 'DEP-' AS `prefix`
  UNION ALL SELECT 'HR_POSITION', 'JOB-'
  UNION ALL SELECT 'EMPLOYEE', 'EMP-'
) AS `types`
WHERE 1 = 1
ON DUPLICATE KEY UPDATE `prefix` = VALUES(`prefix`), `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('hr.employees.view', 'human_resources', 'عرض سجل الموظفين وبياناتهم غير المالية'),
  ('hr.employees.manage', 'human_resources', 'إنشاء الموظفين وتعديل حالتهم وهيكلهم'),
  ('hr.structure.view', 'human_resources', 'عرض الأقسام والمناصب'),
  ('hr.structure.manage', 'human_resources', 'إنشاء وتعديل وتعطيل الأقسام والمناصب'),
  ('hr.contracts.view', 'human_resources', 'عرض عقود العمل غير المالية'),
  ('hr.contracts.manage', 'human_resources', 'إنشاء عقود العمل وإنهاؤها')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'hr.employees.view',
  'hr.employees.manage',
  'hr.structure.view',
  'hr.structure.manage',
  'hr.contracts.view',
  'hr.contracts.manage'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
