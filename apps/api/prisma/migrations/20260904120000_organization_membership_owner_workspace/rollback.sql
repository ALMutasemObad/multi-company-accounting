-- Refuse rollback after group-scoped business activity; deleting those audit and membership
-- facts would destroy authorization history.
DELIMITER $$
DROP PROCEDURE IF EXISTS `rollback_organization_membership_owner_workspace`$$
CREATE PROCEDURE `rollback_organization_membership_owner_workspace`()
BEGIN
  IF EXISTS (SELECT 1 FROM `organization_audit_logs` LIMIT 1)
     OR EXISTS (SELECT 1 FROM `organization_memberships` WHERE `version` <> 0 LIMIT 1) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'organization_membership_rollback_refused_business_activity_exists';
  END IF;

  DROP TABLE `organization_audit_logs`;
  DROP TABLE `organization_memberships`;
END$$
CALL `rollback_organization_membership_owner_workspace`()$$
DROP PROCEDURE `rollback_organization_membership_owner_workspace`$$
DELIMITER ;
