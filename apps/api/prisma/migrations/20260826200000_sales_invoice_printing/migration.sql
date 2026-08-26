INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('sales_invoices.print', 'sales_invoices', 'طباعة وأرشفة فواتير المبيعات والإشعارات الدائنة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `r`.`id`, `p`.`id`
FROM `roles` `r`
JOIN `permissions` `p` ON `p`.`code` = 'sales_invoices.print'
WHERE `r`.`code` = 'ADMINISTRATOR';
