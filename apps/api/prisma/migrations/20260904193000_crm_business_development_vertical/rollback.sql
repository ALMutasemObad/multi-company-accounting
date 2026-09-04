-- Destructive rollback is intentionally guarded. It succeeds only when the
-- CRM slice has no business rows and no replay contract remains in idempotency.
SET @crm_rows := (
  (SELECT COUNT(*) FROM `crm_activities`) +
  (SELECT COUNT(*) FROM `crm_opportunities`) +
  (SELECT COUNT(*) FROM `crm_leads`)
);
SET @crm_idempotency := (
  SELECT COUNT(*) FROM `idempotency_records` WHERE `operation` LIKE 'crm.%'
);
SET @crm_rollback_sql := IF(
  @crm_rows = 0 AND @crm_idempotency = 0,
  'SELECT 1',
  'SELECT * FROM crm_rollback_blocked_non_empty_or_idempotent'
);
PREPARE crm_rollback_stmt FROM @crm_rollback_sql;
EXECUTE crm_rollback_stmt;
DEALLOCATE PREPARE crm_rollback_stmt;

DELETE FROM `role_permissions`
WHERE `permission_id` IN (
  SELECT `id` FROM `permissions` WHERE `code` IN (
    'crm.view', 'crm.manage', 'crm.activities.manage', 'crm.convert'
  )
);
DELETE FROM `permissions`
WHERE `code` IN ('crm.view', 'crm.manage', 'crm.activities.manage', 'crm.convert');
DELETE FROM `master_data_code_sequences`
WHERE `entity_type` IN ('CRM_LEAD', 'CRM_OPPORTUNITY');

DROP TABLE `crm_activities`;
DROP TABLE `crm_opportunities`;
DROP TABLE `crm_leads`;
