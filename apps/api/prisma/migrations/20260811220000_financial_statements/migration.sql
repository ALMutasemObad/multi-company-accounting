INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('reports.financial_position.view', 'reports', 'عرض تقرير المركز المالي'),
  ('reports.income_statement.view', 'reports', 'عرض تقرير قائمة الدخل'),
  ('reports.ledger.view', 'reports', 'عرض تقرير الأستاذ العام وكشف الحساب'),
  ('reports.financial_statements.export', 'reports', 'تصدير القوائم المالية')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'reports.financial_position.view',
  'reports.income_statement.view',
  'reports.ledger.view',
  'reports.financial_statements.export'
)
WHERE `roles`.`code` = 'ADMINISTRATOR';
