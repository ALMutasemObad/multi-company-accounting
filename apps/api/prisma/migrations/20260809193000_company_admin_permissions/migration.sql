INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('companies.view', 'companies', 'عرض بيانات الشركة'),
  ('companies.update', 'companies', 'تعديل بيانات الشركة'),
  ('settings.manage', 'settings', 'إدارة إعدادات الشركة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('companies.view', 'companies.update', 'settings.manage')
WHERE `roles`.`code` = 'ADMINISTRATOR';
