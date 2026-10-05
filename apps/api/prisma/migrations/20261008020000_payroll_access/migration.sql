INSERT INTO `platform_modules` (`code`, `display_name`, `is_active`, `version`, `updated_at`)
VALUES ('PAYROLL', 'Payroll', FALSE, 0, CURRENT_TIMESTAMP(3));
INSERT INTO `platform_module_dependencies` (`module_id`, `depends_on_module_id`)
SELECT payroll.id, dependency.id FROM platform_modules payroll JOIN platform_modules dependency
ON dependency.code IN ('HUMAN_RESOURCES','APPROVALS') WHERE payroll.code = 'PAYROLL';
INSERT INTO permissions (code, module, description_ar) VALUES
('payroll.view','payroll','عرض دورات الرواتب وفق نطاق الخصوصية'),
('payroll.runs.manage','payroll','إعداد وحساب وإرسال دورات الرواتب'),
('payroll.agreements.manage','payroll','إدارة اتفاقات الأجر للمالك فقط');
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT roles.id, permissions.id FROM roles JOIN permissions ON permissions.code LIKE 'payroll.%'
WHERE roles.code = 'ADMINISTRATOR' AND roles.is_system_role = TRUE;
