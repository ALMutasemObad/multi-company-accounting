-- Guarded rollback for SUB-4. Refuse before discarding any payment-provider,
-- refund, webhook, or subscription-invoice history.
DELIMITER $$
DROP PROCEDURE IF EXISTS `rollback_platform_electronic_payments`$$
CREATE PROCEDURE `rollback_platform_electronic_payments`()
BEGIN
  IF EXISTS (SELECT 1 FROM `platform_payment_attempts` LIMIT 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_electronic_payments_rollback_refused_attempts_exist';
  END IF;

  IF EXISTS (SELECT 1 FROM `platform_billing_refunds` LIMIT 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_electronic_payments_rollback_refused_refunds_exist';
  END IF;

  IF EXISTS (SELECT 1 FROM `platform_webhook_receipts` LIMIT 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_electronic_payments_rollback_refused_webhooks_exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM `platform_billing_invoices`
    WHERE `subscription_id` IS NOT NULL
      OR `plan_version_id` IS NOT NULL
      OR `subscription_change_id` IS NOT NULL
      OR `plan_display_name_snapshot` IS NOT NULL
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_electronic_payments_rollback_refused_invoice_links_exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM `platform_billing_payments`
    WHERE `source` = 'ELECTRONIC_PROVIDER' OR `payment_attempt_id` IS NOT NULL
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_electronic_payments_rollback_refused_electronic_payment_exists';
  END IF;

  DROP TABLE `platform_billing_refunds`;

  ALTER TABLE `platform_billing_payments`
    DROP FOREIGN KEY `platform_billing_payments_attempt_fkey`,
    DROP CONSTRAINT `platform_billing_payments_source_actor_chk`,
    DROP INDEX `platform_billing_payments_attempt_key`,
    DROP INDEX `platform_billing_payments_id_company_attempt_key`,
    DROP INDEX `platform_billing_payments_attempt_company_invoice_key`,
    DROP COLUMN `source`,
    DROP COLUMN `payment_attempt_id`,
    MODIFY `received_by_id` BIGINT UNSIGNED NOT NULL;

  DROP TABLE `platform_webhook_receipts`;
  DROP TABLE `platform_payment_transitions`;
  DROP TABLE `platform_checkout_sessions`;
  DROP TABLE `platform_payment_attempts`;

  ALTER TABLE `platform_billing_invoices`
    DROP FOREIGN KEY `platform_billing_invoices_subscription_fkey`,
    DROP FOREIGN KEY `platform_billing_invoices_plan_version_fkey`,
    DROP FOREIGN KEY `platform_billing_invoices_subscription_change_fkey`,
    DROP INDEX `platform_billing_invoices_company_subscription_idx`,
    DROP INDEX `platform_billing_invoices_plan_version_idx`,
    DROP INDEX `platform_billing_invoices_subscription_change_idx`,
    DROP COLUMN `plan_display_name_snapshot`,
    DROP COLUMN `subscription_change_id`,
    DROP COLUMN `plan_version_id`,
    DROP COLUMN `subscription_id`;
END$$
CALL `rollback_platform_electronic_payments`()$$
DROP PROCEDURE `rollback_platform_electronic_payments`$$
DELIMITER ;
