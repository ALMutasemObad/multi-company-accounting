-- Guarded rollback for SUB-3. Refuse once the lifecycle/catalog has business data.
DELIMITER $$
DROP PROCEDURE IF EXISTS `rollback_platform_subscription_lifecycle`$$
CREATE PROCEDURE `rollback_platform_subscription_lifecycle`()
BEGIN
  IF EXISTS (
    SELECT 1 FROM `platform_subscription_changes`
    WHERE `source` <> 'MIGRATION'
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_subscription_lifecycle_rollback_refused_changes_exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM `platform_plans`
    WHERE `created_by_id` IS NOT NULL OR `updated_by_id` IS NOT NULL
    LIMIT 1
  ) OR EXISTS (
    SELECT 1 FROM `platform_plan_versions`
    WHERE `created_by_id` IS NOT NULL OR `updated_by_id` IS NOT NULL OR `published_by_id` IS NOT NULL
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_subscription_lifecycle_rollback_refused_catalog_changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM `platform_plans` plan
    JOIN `platform_plan_versions` version ON version.`plan_id` = plan.`id`
    WHERE plan.`code` IN ('FREE', 'TRIAL', 'BASIC')
      AND (
        plan.`version` <> 0 OR version.`version_number` <> 1 OR version.`version` <> 0
        OR version.`published_at` IS NOT NULL
        OR EXISTS (SELECT 1 FROM `platform_plan_entitlements` entitlement WHERE entitlement.`plan_version_id` = version.`id`)
      )
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_subscription_lifecycle_rollback_refused_templates_modified';
  END IF;

  IF EXISTS (
    SELECT 1 FROM `platform_plan_versions`
    WHERE `plan_id` NOT IN (SELECT `id` FROM `platform_plans` WHERE `code` IN ('FREE', 'TRIAL', 'BASIC'))
      AND (`recurring_fee` IS NULL OR `included_users` IS NULL OR `price_per_additional_user` IS NULL
        OR `included_employees` IS NULL OR `price_per_additional_employee` IS NULL
        OR `included_posted_documents` IS NULL OR `price_per_additional_posted_document` IS NULL
        OR `published_at` IS NULL)
    LIMIT 1
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'platform_subscription_lifecycle_rollback_refused_nullable_catalog_data';
  END IF;

  DELETE change_module
  FROM `platform_subscription_change_modules` change_module
  JOIN `platform_subscription_changes` lifecycle_change ON lifecycle_change.`id` = change_module.`change_id`
  WHERE lifecycle_change.`source` = 'MIGRATION';
  DELETE FROM `platform_subscription_changes` WHERE `source` = 'MIGRATION';

  DELETE entitlement
  FROM `platform_plan_entitlements` entitlement
  JOIN `platform_plan_versions` version ON version.`id` = entitlement.`plan_version_id`
  JOIN `platform_plans` plan ON plan.`id` = version.`plan_id`
  WHERE plan.`code` IN ('FREE', 'TRIAL', 'BASIC');
  DELETE version
  FROM `platform_plan_versions` version
  JOIN `platform_plans` plan ON plan.`id` = version.`plan_id`
  WHERE plan.`code` IN ('FREE', 'TRIAL', 'BASIC');
  DELETE FROM `platform_plans` WHERE `code` IN ('FREE', 'TRIAL', 'BASIC');

  DELETE role_permission
  FROM `role_permissions` role_permission
  JOIN `permissions` permission ON permission.`id` = role_permission.`permission_id`
  WHERE permission.`code` IN ('subscriptions.view', 'subscriptions.manage');
  DELETE FROM `permissions` WHERE `code` IN ('subscriptions.view', 'subscriptions.manage');

  DROP TABLE `platform_subscription_change_modules`;
  DROP TABLE `platform_subscription_changes`;

  ALTER TABLE `platform_plan_entitlements`
    DROP CONSTRAINT `platform_plan_entitlements_selection_chk`,
    DROP COLUMN `additional_recurring_fee`,
    DROP COLUMN `selection_mode`;

  ALTER TABLE `platform_plans`
    DROP FOREIGN KEY `platform_plans_created_by_fkey`,
    DROP FOREIGN KEY `platform_plans_updated_by_fkey`,
    DROP INDEX `platform_plans_active_updated_idx`,
    DROP INDEX `platform_plans_created_by_idx`,
    DROP INDEX `platform_plans_updated_by_idx`,
    DROP COLUMN `updated_by_id`,
    DROP COLUMN `created_by_id`;

  ALTER TABLE `platform_plan_versions`
    DROP FOREIGN KEY `platform_plan_versions_created_by_fkey`,
    DROP FOREIGN KEY `platform_plan_versions_updated_by_fkey`,
    DROP FOREIGN KEY `platform_plan_versions_published_by_fkey`,
    DROP INDEX `platform_plan_versions_catalog_idx`,
    DROP INDEX `platform_plan_versions_created_by_idx`,
    DROP INDEX `platform_plan_versions_updated_by_idx`,
    DROP INDEX `platform_plan_versions_published_by_idx`,
    DROP COLUMN `published_by_id`,
    DROP COLUMN `updated_by_id`,
    DROP COLUMN `created_by_id`,
    DROP COLUMN `self_service_policy`,
    DROP COLUMN `version`,
    MODIFY `recurring_fee` DECIMAL(19,4) NOT NULL DEFAULT 0,
    MODIFY `included_users` INT UNSIGNED NOT NULL DEFAULT 0,
    MODIFY `price_per_additional_user` DECIMAL(19,4) NOT NULL DEFAULT 0,
    MODIFY `included_employees` INT UNSIGNED NOT NULL DEFAULT 0,
    MODIFY `price_per_additional_employee` DECIMAL(19,4) NOT NULL DEFAULT 0,
    MODIFY `included_posted_documents` INT UNSIGNED NOT NULL DEFAULT 0,
    MODIFY `price_per_additional_posted_document` DECIMAL(19,4) NOT NULL DEFAULT 0,
    MODIFY `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
END$$
CALL `rollback_platform_subscription_lifecycle`()$$
DROP PROCEDURE `rollback_platform_subscription_lifecycle`$$
DELIMITER ;
