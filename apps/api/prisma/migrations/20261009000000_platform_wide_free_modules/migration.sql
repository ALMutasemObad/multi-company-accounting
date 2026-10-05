-- Owner-authorized no-fee rollout for all existing and future companies.
-- This migration follows the existing 20261008 migrations; do not backdate it.
-- Do not edit immutable plan versions, subscription entitlements, prices or quotas.
UPDATE `platform_modules`
SET `is_active` = TRUE,
    `version` = `version` + 1,
    `updated_at` = UTC_TIMESTAMP(3)
WHERE `code` IN ('GENERAL_PROJECTS', 'SERVICE_CATALOG', 'PAYROLL')
  AND `is_active` = FALSE;

-- Existing companies predate the runtime permission seeding used by onboarding.
-- Add the same generic catalog permissions to their system administrator roles.
INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('services.view', 'service_catalog', 'عرض كتالوج الخدمات وتصنيفاته وبدائله'),
  ('services.manage', 'service_catalog', 'إدارة تعريفات الخدمات وتصنيفاتها وبدائلها')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('services.view', 'services.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR'
  AND `roles`.`is_system_role` = TRUE;
