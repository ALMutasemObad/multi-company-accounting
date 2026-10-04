-- GPM-2 expands the independent project register; module activation remains separate.
CREATE TABLE `general_project_phases` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `planned_start_date` DATE NULL,
  `target_end_date` DATE NULL,
  `status` ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `gp_phases_public_id_key` (`public_id`),
  UNIQUE KEY `gp_phases_project_sequence_key` (`project_id`, `sequence`),
  UNIQUE KEY `gp_phases_id_project_company_key` (`id`, `project_id`, `company_id`),
  KEY `gp_phases_company_project_status_idx` (`company_id`, `project_id`, `status`),
  CONSTRAINT `gp_phases_dates_chk` CHECK (`planned_start_date` IS NULL OR `target_end_date` IS NULL OR `target_end_date` >= `planned_start_date`),
  CONSTRAINT `gp_phases_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_phases_project_fk` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `general_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_phases_created_by_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_phases_updated_by_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `general_project_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `phase_id` BIGINT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL,
  `title` VARCHAR(200) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `priority` ENUM('LOW', 'NORMAL', 'HIGH', 'URGENT') NOT NULL DEFAULT 'NORMAL',
  `planned_start_date` DATE NULL,
  `due_date` DATE NULL,
  `status` ENUM('TODO', 'IN_PROGRESS', 'BLOCKED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'TODO',
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `gp_tasks_public_id_key` (`public_id`),
  UNIQUE KEY `gp_tasks_phase_sequence_key` (`phase_id`, `sequence`),
  UNIQUE KEY `gp_tasks_id_project_company_key` (`id`, `project_id`, `company_id`),
  KEY `gp_tasks_company_project_status_idx` (`company_id`, `project_id`, `status`),
  KEY `gp_tasks_phase_status_sequence_idx` (`phase_id`, `status`, `sequence`),
  CONSTRAINT `gp_tasks_dates_chk` CHECK (`planned_start_date` IS NULL OR `due_date` IS NULL OR `due_date` >= `planned_start_date`),
  CONSTRAINT `gp_tasks_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_tasks_project_fk` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `general_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_tasks_phase_fk` FOREIGN KEY (`phase_id`, `project_id`, `company_id`) REFERENCES `general_project_phases` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_tasks_created_by_fk` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_tasks_updated_by_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `general_project_task_assignments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `member_id` BIGINT UNSIGNED NOT NULL,
  `role` ENUM('RESPONSIBLE', 'CONTRIBUTOR') NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `assigned_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `assigned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `unassigned_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `gp_assignments_public_id_key` (`public_id`),
  UNIQUE KEY `gp_assignments_task_member_key` (`task_id`, `member_id`),
  KEY `gp_assignments_company_project_active_idx` (`company_id`, `project_id`, `is_active`),
  KEY `gp_assignments_member_project_active_idx` (`member_id`, `project_id`, `company_id`, `is_active`),
  CONSTRAINT `gp_assignments_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_assignments_task_fk` FOREIGN KEY (`task_id`, `project_id`, `company_id`) REFERENCES `general_project_tasks` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_assignments_member_fk` FOREIGN KEY (`member_id`, `project_id`, `company_id`) REFERENCES `general_project_members` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_assignments_assigned_by_fk` FOREIGN KEY (`assigned_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_assignments_updated_by_fk` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES ('general_projects.progress', 'general_projects', 'تحديث تقدم المهام المسندة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'general_projects.progress'
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
