-- Existing companies receive derived, grandfathered rows. Once any profile or
-- compliance data changes, rollback would destroy business identity evidence and
-- is refused. Application rollback should retain the forward-compatible tables.
DROP PROCEDURE IF EXISTS `rollback_company_business_profile_bp1`;

DELIMITER //
CREATE PROCEDURE `rollback_company_business_profile_bp1`()
BEGIN
  IF EXISTS (
    SELECT 1 FROM `company_profiles`
    WHERE `grandfathered_at` IS NULL OR `version` <> 0 OR `compliance_version` <> 0
       OR `country_code` IS NOT NULL OR `phone` IS NOT NULL OR `legal_name` IS NOT NULL
    LIMIT 1
  ) OR EXISTS (SELECT 1 FROM `company_registrations` LIMIT 1)
    OR EXISTS (SELECT 1 FROM `company_tax_registrations` LIMIT 1)
    OR EXISTS (SELECT 1 FROM `company_addresses` LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM `registration_requests`
      WHERE `phone` IS NOT NULL OR `country_code` IS NOT NULL OR `primary_business_activity_code` IS NOT NULL
      LIMIT 1
    ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'company_business_profile_rollback_refused_business_data_exists';
  END IF;

  DELETE `role_permissions`
  FROM `role_permissions`
  JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
  WHERE `permissions`.`code` IN (
    'companies.profile.view', 'companies.profile.manage',
    'companies.compliance.view', 'companies.compliance.manage'
  );
  DELETE FROM `permissions` WHERE `code` IN (
    'companies.profile.view', 'companies.profile.manage',
    'companies.compliance.view', 'companies.compliance.manage'
  );

  DROP TABLE `company_addresses`;
  DROP TABLE `company_tax_registrations`;
  DROP TABLE `company_registrations`;
  DROP TABLE `company_profiles`;
  DROP TABLE `business_activities`;

  ALTER TABLE `registration_requests`
    DROP COLUMN `primary_business_activity_code`,
    DROP COLUMN `country_code`,
    DROP COLUMN `phone`;
END//
DELIMITER ;

CALL `rollback_company_business_profile_bp1`();
DROP PROCEDURE `rollback_company_business_profile_bp1`;
