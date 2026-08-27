ALTER TABLE `professional_projects`
  ADD COLUMN `time_budget_minutes` INT UNSIGNED NULL,
  ADD COLUMN `planning_version` INT UNSIGNED NOT NULL DEFAULT 0,
  ADD CONSTRAINT `professional_projects_time_budget_chk`
    CHECK (`time_budget_minutes` IS NULL OR `time_budget_minutes` > 0);

CREATE TABLE `professional_project_stages` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL,
  `name_ar` VARCHAR(200) NOT NULL,
  `name_en` VARCHAR(200) NULL,
  `description` VARCHAR(1000) NULL,
  `status` ENUM('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
  `planned_start_date` DATE NULL,
  `target_end_date` DATE NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_project_stages_public_id_key` (`public_id`),
  UNIQUE KEY `professional_project_stages_project_sequence_key` (`project_id`, `sequence`),
  UNIQUE KEY `professional_project_stages_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `professional_project_stages_id_project_company_key` (`id`, `project_id`, `company_id`),
  KEY `professional_project_stages_company_project_status_idx` (`company_id`, `project_id`, `status`, `sequence`),
  CONSTRAINT `professional_project_stages_sequence_chk` CHECK (`sequence` > 0),
  CONSTRAINT `professional_project_stages_dates_chk` CHECK (
    `planned_start_date` IS NULL
      OR `target_end_date` IS NULL
      OR `target_end_date` >= `planned_start_date`
  ),
  CONSTRAINT `professional_project_stages_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_stages_project_fkey`
    FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_stages_created_by_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_stages_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_project_tasks` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `stage_id` BIGINT UNSIGNED NOT NULL,
  `sequence` INT UNSIGNED NOT NULL,
  `title_ar` VARCHAR(200) NOT NULL,
  `title_en` VARCHAR(200) NULL,
  `description` VARCHAR(1000) NULL,
  `status` ENUM('TODO', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'TODO',
  `assignee_user_id` BIGINT UNSIGNED NOT NULL,
  `estimated_minutes` INT UNSIGNED NOT NULL,
  `planned_start_date` DATE NULL,
  `due_date` DATE NULL,
  `completed_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_project_tasks_public_id_key` (`public_id`),
  UNIQUE KEY `professional_project_tasks_stage_sequence_key` (`stage_id`, `sequence`),
  UNIQUE KEY `professional_project_tasks_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `professional_project_tasks_id_project_company_key` (`id`, `project_id`, `company_id`),
  KEY `professional_project_tasks_project_status_stage_idx` (`company_id`, `project_id`, `status`, `stage_id`, `sequence`),
  KEY `professional_project_tasks_assignee_status_due_idx` (`company_id`, `assignee_user_id`, `status`, `due_date`),
  CONSTRAINT `professional_project_tasks_sequence_chk` CHECK (`sequence` > 0),
  CONSTRAINT `professional_project_tasks_estimate_chk` CHECK (`estimated_minutes` > 0),
  CONSTRAINT `professional_project_tasks_dates_chk` CHECK (
    `planned_start_date` IS NULL
      OR `due_date` IS NULL
      OR `due_date` >= `planned_start_date`
  ),
  CONSTRAINT `professional_project_tasks_completion_chk` CHECK (
    (`status` = 'COMPLETED' AND `completed_at` IS NOT NULL)
      OR (`status` <> 'COMPLETED' AND `completed_at` IS NULL)
  ),
  CONSTRAINT `professional_project_tasks_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_tasks_project_fkey`
    FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_tasks_stage_fkey`
    FOREIGN KEY (`stage_id`, `project_id`, `company_id`) REFERENCES `professional_project_stages` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_tasks_assignee_fkey`
    FOREIGN KEY (`project_id`, `assignee_user_id`, `company_id`) REFERENCES `professional_project_members` (`project_id`, `user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_tasks_created_by_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_tasks_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `professional_task_dependencies` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NOT NULL,
  `depends_on_task_id` BIGINT UNSIGNED NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `removal_reason` VARCHAR(500) NULL,
  `removed_by_id` BIGINT UNSIGNED NULL,
  `removed_at` DATETIME(3) NULL,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_task_dependencies_public_id_key` (`public_id`),
  UNIQUE KEY `professional_task_dependencies_pair_key` (`task_id`, `depends_on_task_id`),
  UNIQUE KEY `professional_task_dependencies_id_company_key` (`id`, `company_id`),
  KEY `professional_task_dependencies_successor_idx` (`company_id`, `project_id`, `is_active`, `task_id`),
  KEY `professional_task_dependencies_predecessor_idx` (`company_id`, `project_id`, `is_active`, `depends_on_task_id`),
  CONSTRAINT `professional_task_dependencies_not_self_chk` CHECK (`task_id` <> `depends_on_task_id`),
  CONSTRAINT `professional_task_dependencies_removal_chk` CHECK (
    (`is_active` = TRUE AND `removal_reason` IS NULL AND `removed_by_id` IS NULL AND `removed_at` IS NULL)
      OR (`is_active` = FALSE AND `removal_reason` IS NOT NULL AND `removed_by_id` IS NOT NULL AND `removed_at` IS NOT NULL)
  ),
  CONSTRAINT `professional_task_dependencies_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_project_fkey`
    FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_task_fkey`
    FOREIGN KEY (`task_id`, `project_id`, `company_id`) REFERENCES `professional_project_tasks` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_predecessor_fkey`
    FOREIGN KEY (`depends_on_task_id`, `project_id`, `company_id`) REFERENCES `professional_project_tasks` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_created_by_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_task_dependencies_removed_by_fkey`
    FOREIGN KEY (`removed_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `professional_time_entries`
  ADD COLUMN `task_id` BIGINT UNSIGNED NULL AFTER `project_id`,
  ADD KEY `professional_time_entries_company_task_date_idx` (`company_id`, `task_id`, `work_date`, `id`),
  ADD CONSTRAINT `professional_time_entries_task_fkey`
    FOREIGN KEY (`task_id`, `project_id`, `company_id`) REFERENCES `professional_project_tasks` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('professional_planning.view', 'professional_projects', 'عرض مراحل ومهام واعتماديات وميزانية وقت المشاريع المهنية'),
  ('professional_planning.manage', 'professional_projects', 'إدارة مراحل ومهام واعتماديات وميزانية وقت المشاريع المهنية'),
  ('professional_tasks.progress', 'professional_projects', 'تحديث تقدم المهام المهنية للمسؤولين والمديرين')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'professional_planning.view',
  'professional_planning.manage',
  'professional_tasks.progress'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
