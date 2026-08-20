INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('audit_logs.view', 'audit_logs', 'عرض سجل التدقيق'),
  ('audit_logs.export', 'audit_logs', 'تصدير سجل التدقيق')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT r.id, p.id
FROM `roles` r
JOIN `permissions` p ON p.code IN ('audit_logs.view', 'audit_logs.export')
WHERE r.code = 'ADMINISTRATOR';
