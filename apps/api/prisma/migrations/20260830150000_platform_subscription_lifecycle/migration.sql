-- SUB-3: subscription plan catalog and effective-dated subscription lifecycle.
-- Published versions remain immutable in application code; the database shape distinguishes
-- an unpriced draft (NULL) from a plan that is explicitly free (0.0000).

ALTER TABLE `platform_plan_versions`
  ADD COLUMN `version` INT UNSIGNED NOT NULL DEFAULT 0 AFTER `currency_code`,
  ADD COLUMN `self_service_policy` ENUM('DISABLED', 'REQUEST_ONLY', 'IMMEDIATE_FREE') NOT NULL DEFAULT 'DISABLED' AFTER `effective_from`,
  ADD COLUMN `created_by_id` BIGINT UNSIGNED NULL AFTER `retired_at`,
  ADD COLUMN `updated_by_id` BIGINT UNSIGNED NULL AFTER `created_by_id`,
  ADD COLUMN `published_by_id` BIGINT UNSIGNED NULL AFTER `updated_by_id`,
  MODIFY `recurring_fee` DECIMAL(19,4) NULL,
  MODIFY `included_users` INT UNSIGNED NULL,
  MODIFY `price_per_additional_user` DECIMAL(19,4) NULL,
  MODIFY `included_employees` INT UNSIGNED NULL,
  MODIFY `price_per_additional_employee` DECIMAL(19,4) NULL,
  MODIFY `included_posted_documents` INT UNSIGNED NULL,
  MODIFY `price_per_additional_posted_document` DECIMAL(19,4) NULL,
  MODIFY `published_at` DATETIME(3) NULL DEFAULT NULL,
  ADD KEY `platform_plan_versions_catalog_idx` (`published_at`, `effective_from`, `id`),
  ADD KEY `platform_plan_versions_created_by_idx` (`created_by_id`),
  ADD KEY `platform_plan_versions_updated_by_idx` (`updated_by_id`),
  ADD KEY `platform_plan_versions_published_by_idx` (`published_by_id`),
  ADD CONSTRAINT `platform_plan_versions_created_by_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_plan_versions_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_plan_versions_published_by_fkey`
    FOREIGN KEY (`published_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `platform_plans`
  ADD COLUMN `created_by_id` BIGINT UNSIGNED NULL AFTER `version`,
  ADD COLUMN `updated_by_id` BIGINT UNSIGNED NULL AFTER `created_by_id`,
  ADD KEY `platform_plans_active_updated_idx` (`is_active`, `updated_at`, `id`),
  ADD KEY `platform_plans_created_by_idx` (`created_by_id`),
  ADD KEY `platform_plans_updated_by_idx` (`updated_by_id`),
  ADD CONSTRAINT `platform_plans_created_by_fkey`
    FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  ADD CONSTRAINT `platform_plans_updated_by_fkey`
    FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE `platform_plan_entitlements`
  ADD COLUMN `selection_mode` ENUM('INCLUDED', 'OPTIONAL') NOT NULL DEFAULT 'INCLUDED' AFTER `module_id`,
  ADD COLUMN `additional_recurring_fee` DECIMAL(19,4) NULL AFTER `selection_mode`,
  ADD CONSTRAINT `platform_plan_entitlements_selection_chk` CHECK (
    (`selection_mode` = 'INCLUDED' AND `additional_recurring_fee` IS NULL)
    OR (`selection_mode` = 'OPTIONAL' AND `additional_recurring_fee` IS NOT NULL AND `additional_recurring_fee` >= 0)
  );

CREATE TABLE `platform_subscription_changes` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `subscription_id` BIGINT UNSIGNED NOT NULL,
  `from_plan_version_id` BIGINT UNSIGNED NULL,
  `target_plan_version_id` BIGINT UNSIGNED NOT NULL,
  `state` ENUM('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL,
  `source` ENUM('COMPANY_OWNER', 'PLATFORM_OPERATOR', 'MIGRATION') NOT NULL,
  `requested_by_id` BIGINT UNSIGNED NULL,
  `decided_by_id` BIGINT UNSIGNED NULL,
  `requested_subscription_version` INT UNSIGNED NOT NULL,
  `requested_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `effective_at` DATETIME(3) NULL,
  `decided_at` DATETIME(3) NULL,
  `decision_reason` VARCHAR(500) NULL,
  `currency_code` CHAR(3) NOT NULL,
  `base_recurring_fee` DECIMAL(19,4) NOT NULL,
  `optional_recurring_fee` DECIMAL(19,4) NOT NULL,
  `total_recurring_fee` DECIMAL(19,4) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_subscription_changes_public_id_key` (`public_id`),
  UNIQUE KEY `platform_subscription_changes_id_company_key` (`id`, `company_id`),
  KEY `platform_subscription_changes_company_state_effective_idx` (`company_id`, `state`, `effective_at`, `id`),
  KEY `platform_subscription_changes_subscription_state_effective_idx` (`subscription_id`, `state`, `effective_at`, `id`),
  KEY `platform_subscription_changes_target_state_idx` (`target_plan_version_id`, `state`, `id`),
  KEY `platform_subscription_changes_from_version_idx` (`from_plan_version_id`),
  KEY `platform_subscription_changes_requested_by_idx` (`requested_by_id`),
  KEY `platform_subscription_changes_decided_by_idx` (`decided_by_id`),
  CONSTRAINT `platform_subscription_changes_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_subscription_fkey`
    FOREIGN KEY (`subscription_id`, `company_id`) REFERENCES `platform_subscriptions` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_from_version_fkey`
    FOREIGN KEY (`from_plan_version_id`) REFERENCES `platform_plan_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_target_version_fkey`
    FOREIGN KEY (`target_plan_version_id`) REFERENCES `platform_plan_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_requested_by_fkey`
    FOREIGN KEY (`requested_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_decided_by_fkey`
    FOREIGN KEY (`decided_by_id`) REFERENCES `users` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_changes_money_chk` CHECK (
    `base_recurring_fee` >= 0
    AND `optional_recurring_fee` >= 0
    AND `total_recurring_fee` = `base_recurring_fee` + `optional_recurring_fee`
  ),
  CONSTRAINT `platform_subscription_changes_state_chk` CHECK (
    (`state` = 'PENDING_APPROVAL' AND `effective_at` IS NULL AND `decided_at` IS NULL AND `decided_by_id` IS NULL)
    OR (`state` = 'APPROVED' AND `effective_at` IS NOT NULL AND `decided_at` IS NOT NULL)
    OR (`state` IN ('REJECTED', 'CANCELLED') AND `effective_at` IS NULL AND `decided_at` IS NOT NULL)
  )
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_subscription_change_modules` (
  `change_id` BIGINT UNSIGNED NOT NULL,
  `module_id` BIGINT UNSIGNED NOT NULL,
  `selection_mode` ENUM('INCLUDED', 'OPTIONAL') NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`change_id`, `module_id`),
  KEY `platform_subscription_change_modules_module_idx` (`module_id`, `change_id`),
  CONSTRAINT `platform_subscription_change_modules_change_fkey`
    FOREIGN KEY (`change_id`) REFERENCES `platform_subscription_changes` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_change_modules_module_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `platform_modules` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Preserve the pre-SUB-3 effective state as immutable lifecycle history.
INSERT INTO `platform_subscription_changes` (
  `public_id`, `company_id`, `subscription_id`, `from_plan_version_id`, `target_plan_version_id`,
  `state`, `source`, `requested_subscription_version`, `requested_at`, `effective_at`, `decided_at`,
  `decision_reason`, `currency_code`, `base_recurring_fee`, `optional_recurring_fee`, `total_recurring_fee`
)
SELECT
  UUID(), subscription.`company_id`, subscription.`id`, NULL, subscription.`plan_version_id`,
  'APPROVED', 'MIGRATION', subscription.`version`, subscription.`starts_at`, subscription.`starts_at`, subscription.`starts_at`,
  'Grandfathered effective state before SUB-3', plan_version.`currency_code`,
  COALESCE(plan_version.`recurring_fee`, 0), 0, COALESCE(plan_version.`recurring_fee`, 0)
FROM `platform_subscriptions` subscription
JOIN `platform_plan_versions` plan_version ON plan_version.`id` = subscription.`plan_version_id`;

INSERT INTO `platform_subscription_change_modules` (`change_id`, `module_id`, `selection_mode`)
SELECT lifecycle_change.`id`, entitlement.`module_id`, 'INCLUDED'
FROM `platform_subscription_changes` lifecycle_change
JOIN `platform_subscription_entitlements` entitlement
  ON entitlement.`subscription_id` = lifecycle_change.`subscription_id`
  AND entitlement.`company_id` = lifecycle_change.`company_id`
WHERE lifecycle_change.`source` = 'MIGRATION'
  AND lifecycle_change.`state` = 'APPROVED'
  AND entitlement.`effective_from` <= lifecycle_change.`effective_at`
  AND (entitlement.`effective_until` IS NULL OR entitlement.`effective_until` > lifecycle_change.`effective_at`);

-- Configurable starting templates only. FREE/TRIAL are explicitly zero-priced drafts;
-- BASIC is intentionally unpriced. No template is published and no commercial limit is guessed.
INSERT INTO `platform_plans` (`code`, `is_active`, `version`, `created_at`, `updated_at`) VALUES
  ('FREE', TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('TRIAL', TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)),
  ('BASIC', TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3));

INSERT INTO `platform_plan_versions` (
  `plan_id`, `version_number`, `display_name`, `description`, `billing_cycle`, `currency_code`, `version`,
  `recurring_fee`, `included_users`, `price_per_additional_user`, `included_employees`,
  `price_per_additional_employee`, `included_posted_documents`, `price_per_additional_posted_document`,
  `tax_rate`, `payment_terms_days`, `trial_days`, `effective_from`, `self_service_policy`, `published_at`, `created_at`
)
SELECT plan.`id`, 1,
  CASE plan.`code` WHEN 'FREE' THEN 'Free' WHEN 'TRIAL' THEN 'Trial' ELSE 'Basic' END,
  'Configurable draft template; review pricing, limits, modules, and activation policy before publishing',
  'MONTHLY', 'SAR', 0,
  CASE WHEN plan.`code` IN ('FREE', 'TRIAL') THEN 0 ELSE NULL END,
  NULL, NULL, NULL, NULL, NULL, NULL,
  0, 0, 0, CURRENT_TIMESTAMP(3), 'DISABLED', NULL, CURRENT_TIMESTAMP(3)
FROM `platform_plans` plan
WHERE plan.`code` IN ('FREE', 'TRIAL', 'BASIC');

INSERT INTO `permissions` (`code`, `module`, `description_ar`) VALUES
  ('subscriptions.view', 'subscriptions', 'عرض اشتراك الشركة وخطتها'),
  ('subscriptions.manage', 'subscriptions', 'طلب تغيير خطة اشتراك الشركة ووحداتها الاختيارية')
ON DUPLICATE KEY UPDATE
  `module` = VALUES(`module`),
  `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT role.`id`, permission.`id`
FROM `roles` role
JOIN `permissions` permission ON permission.`code` IN ('subscriptions.view', 'subscriptions.manage')
WHERE role.`code` = 'ADMINISTRATOR' AND role.`is_system_role` = TRUE;
