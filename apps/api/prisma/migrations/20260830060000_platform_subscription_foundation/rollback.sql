-- The foundation is reversible only while it still contains derived legacy rows.
-- Once a real plan, version, add-on, or entitlement change exists, retaining commercial
-- history is safer than silently dropping it.
DROP PROCEDURE IF EXISTS `rollback_platform_subscription_foundation`;

DELIMITER //
CREATE PROCEDURE `rollback_platform_subscription_foundation`()
BEGIN
  IF EXISTS (
    SELECT 1
    FROM `platform_plans`
    WHERE `code` NOT REGEXP '^LEGACY_COMPANY_[0-9]+$' OR `version` <> 0
  ) OR EXISTS (
    SELECT 1
    FROM `platform_plan_versions`
    WHERE `version_number` <> 1
  ) OR EXISTS (
    SELECT 1
    FROM `platform_modules`
    WHERE `version` <> 0 OR `code` NOT IN (
      'CORE_ACCOUNTING', 'SALES', 'PURCHASES', 'TREASURY', 'INVENTORY', 'POS',
      'REPORTING', 'DATA_IMPORT', 'APPROVALS', 'PROFESSIONAL_PROJECTS',
      'HUMAN_RESOURCES', 'TAX', 'CRM', 'SERVICE_CATALOG'
    )
  ) OR EXISTS (
    SELECT 1
    FROM `platform_subscriptions`
    WHERE `version` <> 0
  ) OR EXISTS (
    SELECT 1
    FROM `platform_subscription_entitlements`
    WHERE `source` <> 'GRANDFATHERED'
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_subscription_rollback_refused_retain_plan_and_entitlement_history';
  END IF;

  DROP TABLE `platform_subscription_entitlements`;
  DROP TABLE `platform_subscriptions`;
  DROP TABLE `platform_plan_entitlements`;
  DROP TABLE `platform_plan_versions`;
  DROP TABLE `platform_plans`;
  DROP TABLE `platform_module_dependencies`;
  DROP TABLE `platform_modules`;
END//
DELIMITER ;

CALL `rollback_platform_subscription_foundation`();
DROP PROCEDURE `rollback_platform_subscription_foundation`;
