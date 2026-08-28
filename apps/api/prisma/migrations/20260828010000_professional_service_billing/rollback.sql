-- Destructive rollback is safe only before the first use of professional billing.
SET @professional_contract_count = (SELECT COUNT(*) FROM `professional_service_contracts`);
SET @professional_rate_count = (SELECT COUNT(*) FROM `professional_service_rates`);
SET @professional_billing_run_count = (SELECT COUNT(*) FROM `professional_billing_runs`);
SET @professional_billing_source_count = (SELECT COUNT(*) FROM `professional_billing_source_lines`);
SET @professional_billing_rollback_sql = IF(
  @professional_contract_count = 0
    AND @professional_rate_count = 0
    AND @professional_billing_run_count = 0
    AND @professional_billing_source_count = 0,
  'SELECT 1',
  'SELECT * FROM professional_billing_rollback_refused_retain_contract_rate_source_and_invoice_history'
);
PREPARE professional_billing_rollback_statement FROM @professional_billing_rollback_sql;
EXECUTE professional_billing_rollback_statement;
DEALLOCATE PREPARE professional_billing_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN (
  'professional_contracts.view',
  'professional_contracts.manage',
  'professional_rates.view',
  'professional_rates.manage',
  'professional_billing.view',
  'professional_billing.execute'
);

DELETE FROM `permissions`
WHERE `code` IN (
  'professional_contracts.view',
  'professional_contracts.manage',
  'professional_rates.view',
  'professional_rates.manage',
  'professional_billing.view',
  'professional_billing.execute'
);

DROP TABLE `professional_billing_source_lines`;
DROP TABLE `professional_billing_runs`;
DROP TABLE `professional_service_rates`;
DROP TABLE `professional_service_contracts`;
