-- SUB-1: additive subscription catalog and grandfathered entitlement foundation.
-- Existing platform billing fields and invoice history remain authoritative until a
-- later migration explicitly moves invoice issuance to immutable plan versions.

CREATE TABLE `platform_modules` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(64) NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_modules_code_key` (`code`),
  KEY `platform_modules_active_code_idx` (`is_active`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_module_dependencies` (
  `module_id` BIGINT UNSIGNED NOT NULL,
  `depends_on_module_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`module_id`, `depends_on_module_id`),
  KEY `platform_module_dependencies_target_idx` (`depends_on_module_id`, `module_id`),
  CONSTRAINT `platform_module_dependencies_no_self_chk` CHECK (`module_id` <> `depends_on_module_id`),
  CONSTRAINT `platform_module_dependencies_source_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `platform_modules` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_module_dependencies_target_fkey`
    FOREIGN KEY (`depends_on_module_id`) REFERENCES `platform_modules` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plans` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(80) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_plans_code_key` (`code`),
  KEY `platform_plans_active_code_idx` (`is_active`, `code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plan_versions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `plan_id` BIGINT UNSIGNED NOT NULL,
  `version_number` INT UNSIGNED NOT NULL,
  `display_name` VARCHAR(160) NOT NULL,
  `description` VARCHAR(1000) NULL,
  `billing_cycle` ENUM('MONTHLY', 'QUARTERLY', 'ANNUAL') NOT NULL,
  `currency_code` CHAR(3) NOT NULL,
  `recurring_fee` DECIMAL(19,4) NOT NULL DEFAULT 0,
  `included_users` INT UNSIGNED NOT NULL DEFAULT 0,
  `price_per_additional_user` DECIMAL(19,4) NOT NULL DEFAULT 0,
  `included_employees` INT UNSIGNED NOT NULL DEFAULT 0,
  `price_per_additional_employee` DECIMAL(19,4) NOT NULL DEFAULT 0,
  `included_posted_documents` INT UNSIGNED NOT NULL DEFAULT 0,
  `price_per_additional_posted_document` DECIMAL(19,4) NOT NULL DEFAULT 0,
  `tax_rate` DECIMAL(9,4) NOT NULL DEFAULT 0,
  `payment_terms_days` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `trial_days` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `effective_from` DATETIME(3) NOT NULL,
  `published_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `retired_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_plan_versions_plan_version_key` (`plan_id`, `version_number`),
  KEY `platform_plan_versions_plan_effective_idx` (`plan_id`, `effective_from`, `id`),
  CONSTRAINT `platform_plan_versions_plan_fkey`
    FOREIGN KEY (`plan_id`) REFERENCES `platform_plans` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_plan_versions_number_chk` CHECK (`version_number` > 0),
  CONSTRAINT `platform_plan_versions_prices_chk` CHECK (
    `recurring_fee` >= 0
    AND `price_per_additional_user` >= 0
    AND `price_per_additional_employee` >= 0
    AND `price_per_additional_posted_document` >= 0
  ),
  CONSTRAINT `platform_plan_versions_tax_chk` CHECK (`tax_rate` >= 0 AND `tax_rate` <= 100),
  CONSTRAINT `platform_plan_versions_terms_chk` CHECK (`payment_terms_days` <= 365),
  CONSTRAINT `platform_plan_versions_dates_chk` CHECK (`retired_at` IS NULL OR `retired_at` >= `effective_from`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_plan_entitlements` (
  `plan_version_id` BIGINT UNSIGNED NOT NULL,
  `module_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`plan_version_id`, `module_id`),
  KEY `platform_plan_entitlements_module_idx` (`module_id`, `plan_version_id`),
  CONSTRAINT `platform_plan_entitlements_version_fkey`
    FOREIGN KEY (`plan_version_id`) REFERENCES `platform_plan_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_plan_entitlements_module_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `platform_modules` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_subscriptions` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `plan_version_id` BIGINT UNSIGNED NOT NULL,
  `status` ENUM('TRIALING', 'ACTIVE', 'PAST_DUE', 'SUSPENDED', 'CANCELED') NOT NULL DEFAULT 'ACTIVE',
  `starts_at` DATETIME(3) NOT NULL,
  `trial_ends_at` DATETIME(3) NULL,
  `current_period_start` DATE NULL,
  `current_period_end` DATE NULL,
  `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT FALSE,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_subscriptions_company_key` (`company_id`),
  UNIQUE KEY `platform_subscriptions_id_company_key` (`id`, `company_id`),
  KEY `platform_subscriptions_status_period_idx` (`status`, `current_period_end`, `id`),
  KEY `platform_subscriptions_plan_status_idx` (`plan_version_id`, `status`),
  CONSTRAINT `platform_subscriptions_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscriptions_plan_version_fkey`
    FOREIGN KEY (`plan_version_id`) REFERENCES `platform_plan_versions` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscriptions_period_chk` CHECK (
    (`current_period_start` IS NULL AND `current_period_end` IS NULL)
    OR (`current_period_start` IS NOT NULL AND `current_period_end` >= `current_period_start`)
  ),
  CONSTRAINT `platform_subscriptions_trial_chk` CHECK (`trial_ends_at` IS NULL OR `trial_ends_at` >= `starts_at`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platform_subscription_entitlements` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `subscription_id` BIGINT UNSIGNED NOT NULL,
  `module_id` BIGINT UNSIGNED NOT NULL,
  `source` ENUM('PLAN', 'ADD_ON', 'GRANDFATHERED') NOT NULL,
  `effective_from` DATETIME(3) NOT NULL,
  `effective_until` DATETIME(3) NULL,
  `reason` VARCHAR(500) NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `platform_subscription_entitlements_subscription_module_from_key`
    (`subscription_id`, `module_id`, `effective_from`),
  UNIQUE KEY `platform_subscription_entitlements_id_company_key` (`id`, `company_id`),
  KEY `platform_subscription_entitlements_company_effective_idx`
    (`company_id`, `effective_from`, `effective_until`, `id`),
  KEY `platform_subscription_entitlements_module_effective_idx`
    (`module_id`, `effective_from`, `effective_until`),
  CONSTRAINT `platform_subscription_entitlements_company_fkey`
    FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_entitlements_subscription_fkey`
    FOREIGN KEY (`subscription_id`, `company_id`) REFERENCES `platform_subscriptions` (`id`, `company_id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_entitlements_module_fkey`
    FOREIGN KEY (`module_id`) REFERENCES `platform_modules` (`id`)
    ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `platform_subscription_entitlements_dates_chk`
    CHECK (`effective_until` IS NULL OR `effective_until` > `effective_from`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Codes are stable commercial entitlement identifiers, separate from RBAC permission codes.
-- Future modules are present but inactive and therefore are not grandfathered prematurely.
INSERT INTO `platform_modules` (`code`, `display_name`, `is_active`, `version`, `updated_at`) VALUES
  ('CORE_ACCOUNTING', 'Core accounting', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('SALES', 'Sales and receivables', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('PURCHASES', 'Purchases and payables', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('TREASURY', 'Treasury', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('INVENTORY', 'Inventory', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('POS', 'Point of sale', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('REPORTING', 'Reporting', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('DATA_IMPORT', 'Data import', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('APPROVALS', 'Approvals', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('PROFESSIONAL_PROJECTS', 'Professional projects', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('HUMAN_RESOURCES', 'Human resources', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('TAX', 'Tax configuration', TRUE, 0, CURRENT_TIMESTAMP(3)),
  ('CRM', 'Customer relationship management', FALSE, 0, CURRENT_TIMESTAMP(3)),
  ('SERVICE_CATALOG', 'Service catalog', FALSE, 0, CURRENT_TIMESTAMP(3));

INSERT INTO `platform_module_dependencies` (`module_id`, `depends_on_module_id`)
SELECT source_module.`id`, required_module.`id`
FROM (
  SELECT 'SALES' AS `module_code`, 'CORE_ACCOUNTING' AS `required_code`
  UNION ALL SELECT 'PURCHASES', 'CORE_ACCOUNTING'
  UNION ALL SELECT 'TREASURY', 'CORE_ACCOUNTING'
  UNION ALL SELECT 'INVENTORY', 'CORE_ACCOUNTING'
  UNION ALL SELECT 'POS', 'SALES'
  UNION ALL SELECT 'POS', 'TREASURY'
  UNION ALL SELECT 'POS', 'INVENTORY'
  UNION ALL SELECT 'REPORTING', 'CORE_ACCOUNTING'
  UNION ALL SELECT 'PROFESSIONAL_PROJECTS', 'SALES'
  UNION ALL SELECT 'PROFESSIONAL_PROJECTS', 'HUMAN_RESOURCES'
  UNION ALL SELECT 'CRM', 'SALES'
) dependencies
JOIN `platform_modules` source_module ON source_module.`code` = dependencies.`module_code`
JOIN `platform_modules` required_module ON required_module.`code` = dependencies.`required_code`;

-- Every current company receives its own immutable legacy plan version. This avoids
-- inventing shared commercial pricing and guarantees that later entitlement enforcement
-- cannot hide capabilities that existed before the catalog was introduced.
INSERT INTO `platform_plans` (`code`, `is_active`, `version`, `created_at`, `updated_at`)
SELECT CONCAT('LEGACY_COMPANY_', company.`id`), TRUE, 0, company.`created_at`, CURRENT_TIMESTAMP(3)
FROM `companies` company;

INSERT INTO `platform_plan_versions` (
  `plan_id`, `version_number`, `display_name`, `description`, `billing_cycle`, `currency_code`,
  `recurring_fee`, `included_users`, `price_per_additional_user`, `included_employees`,
  `price_per_additional_employee`, `included_posted_documents`, `price_per_additional_posted_document`,
  `tax_rate`, `payment_terms_days`, `trial_days`, `effective_from`, `published_at`, `created_at`
)
SELECT
  plan.`id`,
  1,
  COALESCE(NULLIF(TRIM(account.`plan_name`), ''), 'Legacy full access'),
  'Grandfathered from access that existed before the subscription catalog',
  COALESCE(account.`billing_cycle`, 'MONTHLY'),
  COALESCE(account.`currency_code`, currency.`code`),
  COALESCE(account.`recurring_fee`, 0),
  COALESCE(account.`included_users`, 0),
  COALESCE(account.`price_per_additional_user`, 0),
  COALESCE(account.`included_employees`, 0),
  COALESCE(account.`price_per_additional_employee`, 0),
  COALESCE(account.`included_posted_documents`, 0),
  COALESCE(account.`price_per_additional_posted_document`, 0),
  COALESCE(account.`tax_rate`, 0),
  COALESCE(account.`payment_terms_days`, 0),
  0,
  company.`created_at`,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `companies` company
JOIN `platform_plans` plan ON plan.`code` = CONCAT('LEGACY_COMPANY_', company.`id`)
JOIN `currencies` currency ON currency.`id` = company.`base_currency_id`
LEFT JOIN `platform_billing_accounts` account ON account.`company_id` = company.`id`;

INSERT INTO `platform_plan_entitlements` (`plan_version_id`, `module_id`)
SELECT plan_version.`id`, module.`id`
FROM `platform_plan_versions` plan_version
CROSS JOIN `platform_modules` module
WHERE module.`is_active` = TRUE;

INSERT INTO `platform_subscriptions` (
  `company_id`, `plan_version_id`, `status`, `starts_at`, `trial_ends_at`,
  `current_period_start`, `current_period_end`, `cancel_at_period_end`, `version`,
  `created_at`, `updated_at`
)
SELECT
  company.`id`,
  plan_version.`id`,
  CASE account.`status`
    WHEN 'TRIAL' THEN 'TRIALING'
    WHEN 'PAUSED' THEN 'SUSPENDED'
    WHEN 'CLOSED' THEN 'CANCELED'
    ELSE 'ACTIVE'
  END,
  company.`created_at`,
  NULL,
  NULL,
  NULL,
  FALSE,
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `companies` company
JOIN `platform_plans` plan ON plan.`code` = CONCAT('LEGACY_COMPANY_', company.`id`)
JOIN `platform_plan_versions` plan_version
  ON plan_version.`plan_id` = plan.`id` AND plan_version.`version_number` = 1
LEFT JOIN `platform_billing_accounts` account ON account.`company_id` = company.`id`;

INSERT INTO `platform_subscription_entitlements` (
  `company_id`, `subscription_id`, `module_id`, `source`, `effective_from`,
  `effective_until`, `reason`, `created_at`
)
SELECT
  subscription.`company_id`,
  subscription.`id`,
  module.`id`,
  'GRANDFATHERED',
  subscription.`starts_at`,
  NULL,
  'Preserve pre-catalog module access',
  CURRENT_TIMESTAMP(3)
FROM `platform_subscriptions` subscription
CROSS JOIN `platform_modules` module
WHERE module.`is_active` = TRUE;
