-- Keep generated inventory item codes ahead of legacy/demo rows that may have
-- been inserted before the shared master-data sequence existed.
INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `created_at`, `updated_at`)
SELECT company_id, 'INVENTORY_ITEM', 'ITM-', MAX(CAST(SUBSTRING(code, 5) AS UNSIGNED)) + 1, 6,
       CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `inventory_items`
WHERE code REGEXP '^ITM-[0-9]+$'
GROUP BY company_id
ON DUPLICATE KEY UPDATE
  `next_number` = GREATEST(`next_number`, VALUES(`next_number`)),
  `updated_at` = CURRENT_TIMESTAMP(3);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('inventory_counts.enter', 'inventory', 'تسجيل دفعات العد في جلسات الجرد'),
  ('inventory_counts.manage', 'inventory', 'إنشاء جلسات الجرد ومراجعتها واعتمادها وتسويتها')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

-- Existing inventory managers keep their capabilities after the split.
INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT role.id, permission.id
FROM `roles` role
JOIN `role_permissions` existing ON existing.role_id = role.id
JOIN `permissions` legacy ON legacy.id = existing.permission_id AND legacy.code = 'inventory_movements.create'
JOIN `permissions` permission ON permission.code IN ('inventory_counts.enter', 'inventory_counts.manage');
