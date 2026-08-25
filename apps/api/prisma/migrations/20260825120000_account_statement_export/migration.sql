INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES ('reports.ledger.export', 'reports', 'تصدير كشف حساب الأستاذ أو العميل أو المورد')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'reports.ledger.export'
WHERE `roles`.`code` = 'ADMINISTRATOR';
