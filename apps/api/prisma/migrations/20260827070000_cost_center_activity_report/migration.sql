INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('reports.cost_centers.view', 'reports', 'عرض تقرير حركة مراكز التكلفة الفعلية'),
  ('reports.cost_centers.export', 'reports', 'تصدير تقرير حركة مراكز التكلفة الفعلية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('reports.cost_centers.view', 'reports.cost_centers.export')
WHERE `roles`.`code` = 'ADMINISTRATOR';
