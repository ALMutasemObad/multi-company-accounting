CREATE TABLE `crm_leads` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `kind` ENUM('INDIVIDUAL', 'ORGANIZATION') NOT NULL,
  `display_name` VARCHAR(200) NOT NULL,
  `contact_name` VARCHAR(160) NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(320) NULL,
  `source` ENUM('MANUAL', 'REFERRAL', 'WEBSITE', 'OTHER') NOT NULL,
  `source_details` VARCHAR(500) NULL,
  `status` ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'DISQUALIFIED', 'CONVERTED') NOT NULL DEFAULT 'NEW',
  `owner_employee_id` BIGINT UNSIGNED NOT NULL,
  `summary` VARCHAR(1000) NULL,
  `converted_customer_id` BIGINT UNSIGNED NULL,
  `converted_at` DATETIME(3) NULL,
  `disqualification_reason` VARCHAR(500) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `crm_leads_public_id_key` (`public_id`),
  UNIQUE KEY `crm_leads_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `crm_leads_id_company_key` (`id`, `company_id`),
  KEY `crm_leads_company_status_created_id_idx` (`company_id`, `status`, `created_at`, `id`),
  KEY `crm_leads_company_owner_status_id_idx` (`company_id`, `owner_employee_id`, `status`, `id`),
  KEY `crm_leads_company_display_name_id_idx` (`company_id`, `display_name`, `id`),
  KEY `crm_leads_company_customer_idx` (`company_id`, `converted_customer_id`),
  CONSTRAINT `crm_leads_conversion_state_chk` CHECK (
    (`status` = 'CONVERTED' AND `converted_customer_id` IS NOT NULL AND `converted_at` IS NOT NULL)
    OR (`status` <> 'CONVERTED' AND `converted_customer_id` IS NULL AND `converted_at` IS NULL)
  ),
  CONSTRAINT `crm_leads_disqualified_reason_chk` CHECK (
    (`status` = 'DISQUALIFIED' AND `disqualification_reason` IS NOT NULL)
    OR (`status` <> 'DISQUALIFIED' AND `disqualification_reason` IS NULL)
  ),
  CONSTRAINT `crm_leads_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_leads_owner_company_fkey` FOREIGN KEY (`owner_employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_leads_customer_company_fkey` FOREIGN KEY (`converted_customer_id`, `company_id`) REFERENCES `customers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_leads_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_leads_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `crm_opportunities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `lead_id` BIGINT UNSIGNED NULL,
  `customer_id` BIGINT UNSIGNED NULL,
  `title` VARCHAR(200) NOT NULL,
  `stage` ENUM('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST') NOT NULL DEFAULT 'DISCOVERY',
  `previous_open_stage` ENUM('DISCOVERY', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST') NULL,
  `owner_employee_id` BIGINT UNSIGNED NOT NULL,
  `expected_close_date` DATE NULL,
  `estimated_amount` DECIMAL(19,4) NULL,
  `currency_id` BIGINT UNSIGNED NULL,
  `probability_bps` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `lost_reason` VARCHAR(500) NULL,
  `won_at` DATETIME(3) NULL,
  `lost_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `crm_opportunities_public_id_key` (`public_id`),
  UNIQUE KEY `crm_opportunities_company_code_key` (`company_id`, `code`),
  UNIQUE KEY `crm_opportunities_id_company_key` (`id`, `company_id`),
  UNIQUE KEY `crm_opportunities_lead_company_key` (`lead_id`, `company_id`),
  KEY `crm_opportunities_company_stage_close_id_idx` (`company_id`, `stage`, `expected_close_date`, `id`),
  KEY `crm_opportunities_company_owner_stage_id_idx` (`company_id`, `owner_employee_id`, `stage`, `id`),
  KEY `crm_opportunities_company_customer_stage_id_idx` (`company_id`, `customer_id`, `stage`, `id`),
  KEY `crm_opportunities_company_currency_stage_id_idx` (`company_id`, `currency_id`, `stage`, `id`),
  CONSTRAINT `crm_opportunities_party_chk` CHECK (`lead_id` IS NOT NULL OR `customer_id` IS NOT NULL),
  CONSTRAINT `crm_opportunities_amount_currency_chk` CHECK (
    (`estimated_amount` IS NULL AND `currency_id` IS NULL)
    OR (`estimated_amount` IS NOT NULL AND `currency_id` IS NOT NULL AND `estimated_amount` >= 0)
  ),
  CONSTRAINT `crm_opportunities_probability_chk` CHECK (`probability_bps` <= 10000),
  CONSTRAINT `crm_opportunities_terminal_state_chk` CHECK (
    (`stage` = 'WON' AND `won_at` IS NOT NULL AND `lost_at` IS NULL AND `lost_reason` IS NULL)
    OR (`stage` = 'LOST' AND `lost_at` IS NOT NULL AND `won_at` IS NULL AND `lost_reason` IS NOT NULL)
    OR (`stage` IN ('DISCOVERY', 'PROPOSAL', 'NEGOTIATION') AND `won_at` IS NULL AND `lost_at` IS NULL AND `lost_reason` IS NULL)
  ),
  CONSTRAINT `crm_opportunities_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_lead_company_fkey` FOREIGN KEY (`lead_id`, `company_id`) REFERENCES `crm_leads` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_customer_company_fkey` FOREIGN KEY (`customer_id`, `company_id`) REFERENCES `customers` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_owner_company_fkey` FOREIGN KEY (`owner_employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_currency_company_fkey` FOREIGN KEY (`company_id`, `currency_id`) REFERENCES `company_currencies` (`company_id`, `currency_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_opportunities_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `crm_activities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `public_id` CHAR(36) NOT NULL,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `lead_id` BIGINT UNSIGNED NULL,
  `opportunity_id` BIGINT UNSIGNED NULL,
  `type` ENUM('CALL', 'MEETING', 'TASK', 'NOTE') NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `details` VARCHAR(1000) NULL,
  `assigned_employee_id` BIGINT UNSIGNED NOT NULL,
  `scheduled_for` DATETIME(3) NULL,
  `status` ENUM('OPEN', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'OPEN',
  `completed_at` DATETIME(3) NULL,
  `cancelled_at` DATETIME(3) NULL,
  `cancellation_reason` VARCHAR(500) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_by_id` BIGINT UNSIGNED NOT NULL,
  `updated_by_id` BIGINT UNSIGNED NOT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `crm_activities_public_id_key` (`public_id`),
  UNIQUE KEY `crm_activities_id_company_key` (`id`, `company_id`),
  KEY `crm_activities_company_status_schedule_id_idx` (`company_id`, `status`, `scheduled_for`, `id`),
  KEY `crm_activities_company_assignee_status_idx` (`company_id`, `assigned_employee_id`, `status`, `scheduled_for`, `id`),
  KEY `crm_activities_company_lead_created_id_idx` (`company_id`, `lead_id`, `created_at`, `id`),
  KEY `crm_activities_company_opportunity_created_id_idx` (`company_id`, `opportunity_id`, `created_at`, `id`),
  CONSTRAINT `crm_activities_parent_chk` CHECK ((`lead_id` IS NULL) <> (`opportunity_id` IS NULL)),
  CONSTRAINT `crm_activities_state_chk` CHECK (
    (`status` = 'OPEN' AND `completed_at` IS NULL AND `cancelled_at` IS NULL AND `cancellation_reason` IS NULL)
    OR (`status` = 'COMPLETED' AND `completed_at` IS NOT NULL AND `cancelled_at` IS NULL AND `cancellation_reason` IS NULL)
    OR (`status` = 'CANCELLED' AND `completed_at` IS NULL AND `cancelled_at` IS NOT NULL AND `cancellation_reason` IS NOT NULL)
  ),
  CONSTRAINT `crm_activities_company_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_activities_lead_company_fkey` FOREIGN KEY (`lead_id`, `company_id`) REFERENCES `crm_leads` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_activities_opportunity_company_fkey` FOREIGN KEY (`opportunity_id`, `company_id`) REFERENCES `crm_opportunities` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_activities_assignee_company_fkey` FOREIGN KEY (`assigned_employee_id`, `company_id`) REFERENCES `employees` (`id`, `company_id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_activities_created_by_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT `crm_activities_updated_by_fkey` FOREIGN KEY (`updated_by_id`) REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `master_data_code_sequences`
  (`company_id`, `entity_type`, `prefix`, `next_number`, `padding`, `updated_at`)
SELECT `companies`.`id`, `types`.`entity_type`, `types`.`prefix`, 1, 6, CURRENT_TIMESTAMP(3)
FROM `companies`
CROSS JOIN (
  SELECT 'CRM_LEAD' AS `entity_type`, 'LED-' AS `prefix`
  UNION ALL SELECT 'CRM_OPPORTUNITY', 'OPP-'
) AS `types`
ON DUPLICATE KEY UPDATE `prefix` = VALUES(`prefix`), `padding` = VALUES(`padding`);

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('crm.view', 'crm', 'عرض العملاء المحتملين والفرص والأنشطة'),
  ('crm.manage', 'crm', 'إدارة العملاء المحتملين والفرص'),
  ('crm.activities.manage', 'crm', 'إدارة أنشطة المتابعة والإجراء التالي'),
  ('crm.convert', 'crm', 'تحويل العميل المحتمل إلى عميل')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'crm.view',
  'crm.manage',
  'crm.activities.manage',
  'crm.convert'
)
WHERE `roles`.`code` = 'ADMINISTRATOR' AND `roles`.`is_system_role` = TRUE;
