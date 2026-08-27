INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES ('reports.tax_summary.view', 'reports', 'عرض ملخص الضريبة الداخلي المحايد للدولة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'reports.tax_summary.view'
WHERE `roles`.`code` = 'ADMINISTRATOR';
