-- GPM-4 keeps self-following and plain-text comments inside an independent company project.
CREATE TABLE `general_project_followers` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `followed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `unfollowed_at` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `gp_followers_project_user_key` (`project_id`, `user_id`),
  KEY `gp_followers_company_user_active_idx` (`company_id`, `user_id`, `is_active`),
  KEY `gp_followers_project_company_idx` (`project_id`, `company_id`),
  KEY `gp_followers_user_company_idx` (`user_id`, `company_id`),
  CONSTRAINT `gp_followers_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_followers_project_fk` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `general_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_followers_user_company_fk` FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `general_project_comments` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `task_id` BIGINT UNSIGNED NULL,
  `author_user_id` BIGINT UNSIGNED NOT NULL,
  `body` VARCHAR(2000) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `gp_comments_public_id_key` (`public_id`),
  KEY `gp_comments_company_project_created_idx` (`company_id`, `project_id`, `created_at`, `id`),
  KEY `gp_comments_company_project_task_created_idx` (`company_id`, `project_id`, `task_id`, `created_at`, `id`),
  KEY `gp_comments_project_company_idx` (`project_id`, `company_id`),
  KEY `gp_comments_task_project_company_idx` (`task_id`, `project_id`, `company_id`),
  KEY `gp_comments_author_company_idx` (`author_user_id`, `company_id`),
  CONSTRAINT `gp_comments_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_comments_project_fk` FOREIGN KEY (`project_id`, `company_id`) REFERENCES `general_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_comments_task_fk` FOREIGN KEY (`task_id`, `project_id`, `company_id`) REFERENCES `general_project_tasks` (`id`, `project_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `gp_comments_author_company_fk` FOREIGN KEY (`author_user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('general_projects.follow', 'general_projects', 'متابعة المشاريع ذاتيًا'),
  ('general_projects.comment', 'general_projects', 'إضافة تعليقات المشاريع')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('general_projects.follow', 'general_projects.comment')
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
