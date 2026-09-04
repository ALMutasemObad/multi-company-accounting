-- Organization membership is owned by Identity & Access. It grants group-workspace
-- visibility only; company access remains in user_companies and platform access remains external.
CREATE TABLE `organization_memberships` (
    `organization_id` BIGINT UNSIGNED NOT NULL,
    `user_id` BIGINT UNSIGNED NOT NULL,
    `role` ENUM('OWNER', 'ADMIN', 'VIEWER') NOT NULL DEFAULT 'VIEWER',
    `is_active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER UNSIGNED NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organization_memberships_user_id_is_active_idx`(`user_id`, `is_active`),
    INDEX `organization_memberships_organization_id_role_is_active_idx`(`organization_id`, `role`, `is_active`),
    PRIMARY KEY (`organization_id`, `user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_memberships`
  ADD CONSTRAINT `organization_memberships_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `organization_memberships_user_id_fkey`
    FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Backfill every user already active in an organization. Prefer the earliest company
-- administrator as the deterministic initial owner; all other existing users are viewers.
INSERT INTO `organization_memberships`
  (`organization_id`, `user_id`, `role`, `is_active`, `version`, `created_at`, `updated_at`)
SELECT ranked.`organization_id`, ranked.`user_id`,
       CASE WHEN ranked.`owner_rank` = 1 THEN 'OWNER' ELSE 'VIEWER' END,
       true, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM (
  SELECT candidates.`organization_id`, candidates.`user_id`,
         ROW_NUMBER() OVER (
           PARTITION BY candidates.`organization_id`
           ORDER BY candidates.`administrator_priority`, candidates.`first_assignment_at`, candidates.`user_id`
         ) AS `owner_rank`
  FROM (
    SELECT company.`organization_id`, assignment.`user_id`,
           MIN(CASE WHEN role.`code` = 'ADMINISTRATOR' AND role.`is_active` = true THEN 0 ELSE 1 END) AS `administrator_priority`,
           MIN(assignment.`created_at`) AS `first_assignment_at`
    FROM `user_companies` assignment
    JOIN `users` user_account ON user_account.`id` = assignment.`user_id` AND user_account.`is_active` = true
    JOIN `companies` company ON company.`id` = assignment.`company_id`
    LEFT JOIN `user_company_roles` assignment_role
      ON assignment_role.`user_id` = assignment.`user_id`
     AND assignment_role.`company_id` = assignment.`company_id`
    LEFT JOIN `roles` role
      ON role.`id` = assignment_role.`role_id`
     AND role.`company_id` = assignment_role.`company_id`
    WHERE assignment.`is_active` = true
    GROUP BY company.`organization_id`, assignment.`user_id`
  ) candidates
) ranked;

-- Group-level actions have their own Audit-owned scope; company audit isolation stays unchanged.
CREATE TABLE `organization_audit_logs` (
    `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `organization_id` BIGINT UNSIGNED NOT NULL,
    `actor_user_id` BIGINT UNSIGNED NOT NULL,
    `action` VARCHAR(120) NOT NULL,
    `entity_type` VARCHAR(80) NOT NULL,
    `entity_id` VARCHAR(64) NOT NULL,
    `details` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `organization_audit_logs_organization_id_created_at_idx`(`organization_id`, `created_at`),
    INDEX `organization_audit_logs_actor_user_id_created_at_idx`(`actor_user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `organization_audit_logs`
  ADD CONSTRAINT `organization_audit_logs_organization_id_fkey`
    FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `organization_audit_logs_actor_user_id_fkey`
    FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;
