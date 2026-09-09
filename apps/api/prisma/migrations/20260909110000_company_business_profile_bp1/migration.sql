ALTER TABLE `registration_requests`
  ADD COLUMN `phone` VARCHAR(40) NULL AFTER `chart_template_code`,
  ADD COLUMN `country_code` CHAR(2) NULL AFTER `phone`,
  ADD COLUMN `primary_business_activity_code` VARCHAR(80) NULL AFTER `country_code`;

CREATE TABLE `business_activities` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(80) NOT NULL,
  `name_ar` VARCHAR(160) NOT NULL,
  `name_en` VARCHAR(160) NOT NULL,
  `is_active` BOOLEAN NOT NULL DEFAULT TRUE,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `business_activities_code_key` (`code`),
  INDEX `business_activities_active_code_idx` (`is_active`, `code`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `business_activities` (`code`, `name_ar`, `name_en`)
VALUES
  ('PROFESSIONAL_SERVICES', 'خدمات مهنية', 'Professional services'),
  ('RETAIL_TRADE', 'تجارة التجزئة', 'Retail trade'),
  ('WHOLESALE_TRADE', 'تجارة الجملة', 'Wholesale trade'),
  ('MANUFACTURING', 'إنتاج وتصنيع', 'Manufacturing'),
  ('OTHER', 'نشاط آخر', 'Other activity');

CREATE TABLE `company_profiles` (
  `company_id` BIGINT UNSIGNED NOT NULL,
  `trade_name` VARCHAR(200) NULL,
  `legal_name` VARCHAR(200) NULL,
  `country_code` CHAR(2) NULL,
  `legal_form` VARCHAR(100) NULL,
  `preferred_locale` VARCHAR(35) NULL,
  `phone` VARCHAR(40) NULL,
  `email` VARCHAR(320) NULL,
  `website` VARCHAR(500) NULL,
  `primary_contact_name` VARCHAR(160) NULL,
  `primary_business_activity_id` BIGINT UNSIGNED NULL,
  `initial_chart_template_code` VARCHAR(80) NULL,
  `grandfathered_at` DATETIME(3) NULL,
  `version` INT UNSIGNED NOT NULL DEFAULT 0,
  `compliance_version` INT UNSIGNED NOT NULL DEFAULT 0,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `company_profiles_activity_idx` (`primary_business_activity_id`),
  INDEX `company_profiles_country_idx` (`country_code`),
  PRIMARY KEY (`company_id`),
  CONSTRAINT `company_profiles_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT `company_profiles_activity_fk` FOREIGN KEY (`primary_business_activity_id`) REFERENCES `business_activities` (`id`) ON DELETE RESTRICT ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `company_profiles` (
  `company_id`, `trade_name`, `initial_chart_template_code`, `grandfathered_at`
)
SELECT `id`, `name`, 'SMALL_BUSINESS_GENERAL', CURRENT_TIMESTAMP(3)
FROM `companies`;

CREATE TABLE `company_registrations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `document_type` VARCHAR(80) NOT NULL,
  `number_last4` VARCHAR(4) NULL,
  `issuing_authority` VARCHAR(200) NULL,
  `issued_at` DATE NULL,
  `expires_at` DATE NULL,
  `status` ENUM('DECLARED', 'VERIFIED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'DECLARED',
  `verified_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `company_registrations_company_type_key` (`company_id`, `document_type`),
  INDEX `company_registrations_expiry_idx` (`company_id`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `company_registrations_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `company_tax_registrations` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `registration_type` VARCHAR(80) NOT NULL,
  `country_code` CHAR(2) NOT NULL,
  `number_last4` VARCHAR(4) NULL,
  `issued_at` DATE NULL,
  `expires_at` DATE NULL,
  `status` ENUM('DECLARED', 'VERIFIED', 'REJECTED', 'EXPIRED') NOT NULL DEFAULT 'DECLARED',
  `verified_at` DATETIME(3) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `company_tax_company_type_country_key` (`company_id`, `registration_type`, `country_code`),
  INDEX `company_tax_expiry_idx` (`company_id`, `expires_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `company_tax_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `company_addresses` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `company_id` BIGINT UNSIGNED NOT NULL,
  `type` ENUM('REGISTERED', 'NATIONAL', 'OPERATING', 'BILLING') NOT NULL,
  `line1` VARCHAR(200) NULL,
  `line2` VARCHAR(200) NULL,
  `district` VARCHAR(120) NULL,
  `city` VARCHAR(120) NULL,
  `subdivision` VARCHAR(120) NULL,
  `postal_code` VARCHAR(40) NULL,
  `country_code` CHAR(2) NOT NULL,
  `display_address` VARCHAR(500) NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `company_addresses_company_type_key` (`company_id`, `type`),
  INDEX `company_addresses_company_country_idx` (`company_id`, `country_code`),
  PRIMARY KEY (`id`),
  CONSTRAINT `company_addresses_company_fk` FOREIGN KEY (`company_id`) REFERENCES `companies` (`id`) ON DELETE CASCADE ON UPDATE RESTRICT
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

INSERT INTO `permissions` (`code`, `module`, `description_ar`)
VALUES
  ('companies.profile.view', 'companies', 'عرض الملف التجاري للمنشأة'),
  ('companies.profile.manage', 'companies', 'إدارة الملف التجاري للمنشأة'),
  ('companies.compliance.view', 'companies', 'عرض البيانات النظامية للمنشأة'),
  ('companies.compliance.manage', 'companies', 'إدارة البيانات النظامية للمنشأة')
ON DUPLICATE KEY UPDATE `module` = VALUES(`module`), `description_ar` = VALUES(`description_ar`);

INSERT IGNORE INTO `role_permissions` (`role_id`, `permission_id`)
SELECT `roles`.`id`, `permissions`.`id`
FROM `roles`
JOIN `permissions` ON `permissions`.`code` IN (
  'companies.profile.view', 'companies.profile.manage',
  'companies.compliance.view', 'companies.compliance.manage'
)
WHERE `roles`.`code` = 'ADMINISTRATOR';
