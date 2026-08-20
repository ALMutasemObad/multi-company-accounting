INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('dashboard.view', 'dashboard', 'عرض لوحة التحكم المالية'),
  ('reports.trial_balance.view', 'reports', 'عرض تقرير ميزان المراجعة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('dashboard.view', 'reports.trial_balance.view')
WHERE `roles`.`code` = 'ADMINISTRATOR';
