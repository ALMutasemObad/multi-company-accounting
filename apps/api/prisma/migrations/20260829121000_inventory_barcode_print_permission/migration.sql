INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('inventory_barcodes.print', 'inventory', 'تنزيل ملصقات باركود الأصناف')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` = 'inventory_barcodes.print'
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
