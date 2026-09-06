-- Never discard committed replay protection.
DELIMITER $$
DROP PROCEDURE IF EXISTS `rollback_organization_idempotency`$$
CREATE PROCEDURE `rollback_organization_idempotency`()
BEGIN
  IF EXISTS (SELECT 1 FROM `organization_idempotency_records` LIMIT 1) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'organization_idempotency_rollback_refused_records_exist';
  END IF;
  DROP TABLE `organization_idempotency_records`;
END$$
CALL `rollback_organization_idempotency`()$$
DROP PROCEDURE `rollback_organization_idempotency`$$
DELIMITER ;
