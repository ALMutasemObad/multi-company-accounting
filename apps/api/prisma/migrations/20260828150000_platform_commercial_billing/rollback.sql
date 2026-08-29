SET @platform_billing_account_count = (SELECT COUNT(*) FROM `platform_billing_accounts`);
SET @platform_billing_invoice_count = (SELECT COUNT(*) FROM `platform_billing_invoices`);
SET @platform_billing_payment_count = (SELECT COUNT(*) FROM `platform_billing_payments`);
SET @platform_billing_rollback_sql = IF(
  @platform_billing_account_count = 0
    AND @platform_billing_invoice_count = 0
    AND @platform_billing_payment_count = 0,
  'SELECT 1',
  'SELECT * FROM platform_billing_rollback_refused_retain_account_invoice_and_payment_history'
);
PREPARE platform_billing_rollback_statement FROM @platform_billing_rollback_sql;
EXECUTE platform_billing_rollback_statement;
DEALLOCATE PREPARE platform_billing_rollback_statement;

DROP TABLE `platform_billing_payments`;
DROP TABLE `platform_billing_invoice_lines`;
DROP TABLE `platform_billing_invoices`;
DROP TABLE `platform_billing_accounts`;
