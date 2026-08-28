ALTER TABLE `professional_projects`
  ADD COLUMN `access_mode` ENUM('COMPANY', 'RESTRICTED') NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN `access_version` INT UNSIGNED NOT NULL DEFAULT 0;

CREATE TABLE `professional_project_access_grants` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `project_id` BIGINT UNSIGNED NOT NULL,
  `user_id` BIGINT UNSIGNED NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `grant_reason` VARCHAR(500) NOT NULL,
  `granted_by_id` BIGINT UNSIGNED NOT NULL,
  `granted_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `revocation_reason` VARCHAR(500) NULL,
  `revoked_by_id` BIGINT UNSIGNED NULL,
  `revoked_at` DATETIME(3) NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `professional_project_access_grants_public_id_key` (`public_id`),
  UNIQUE KEY `professional_project_access_grants_project_user_key` (`project_id`, `user_id`),
  UNIQUE KEY `professional_project_access_grants_id_company_key` (`id`, `company_id`),
  KEY `professional_project_access_grants_company_user_active_idx` (`company_id`, `user_id`, `is_active`),
  KEY `professional_project_access_grants_project_active_user_idx` (`project_id`, `is_active`, `user_id`),
  KEY `professional_project_access_grants_company_granted_by_idx` (`company_id`, `granted_by_id`),
  KEY `professional_project_access_grants_company_revoked_by_idx` (`company_id`, `revoked_by_id`),
  CONSTRAINT `professional_project_access_grants_state_chk` CHECK (
    (`is_active` = TRUE AND `revocation_reason` IS NULL AND `revoked_by_id` IS NULL AND `revoked_at` IS NULL)
      OR (`is_active` = FALSE AND `revocation_reason` IS NOT NULL AND `revoked_by_id` IS NOT NULL AND `revoked_at` IS NOT NULL)
  ),
  CONSTRAINT `professional_project_access_grants_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_access_grants_project_fkey`
    FOREIGN KEY (`project_id`, `company_id`) REFERENCES `professional_projects` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_access_grants_assignment_fkey`
    FOREIGN KEY (`user_id`, `company_id`) REFERENCES `user_companies` (`user_id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_access_grants_granted_by_fkey`
    FOREIGN KEY (`granted_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_access_grants_revoked_by_fkey`
    FOREIGN KEY (`revoked_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `professional_project_access_grants_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES ('professional_access.manage', 'professional_projects', 'إدارة الجدار الأخلاقي ومنح الوصول للقضايا المهنية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'professional_access.manage'
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
