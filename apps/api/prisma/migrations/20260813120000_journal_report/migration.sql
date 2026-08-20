INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('reports.journal.view', 'reports', 'عرض تقرير دفتر اليومية'),
  ('reports.journal.export', 'reports', 'تصدير تقرير دفتر اليومية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN ('reports.journal.view', 'reports.journal.export')
WHERE `roles`.`code` = 'ADMINISTRATOR';
