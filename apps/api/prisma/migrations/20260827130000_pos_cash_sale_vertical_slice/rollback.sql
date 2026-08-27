-- Operational rollback is application-first: deploy a version without the POS
-- router and UI, while retaining pos_sales as an immutable audit link.
-- This destructive rollback is intentionally guarded and only succeeds when
-- the module has never completed a checkout in the target database.
SET @pos_sale_count = (SELECT COUNT(*) FROM `pos_sales`);
SET @drop_pos_sql = IF(
  @pos_sale_count = 0,
  'DROP TABLE `pos_sales`',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Refusing to drop non-empty pos_sales; use application rollback and retain audit links'''
);
PREPARE pos_rollback_statement FROM @drop_pos_sql;
EXECUTE pos_rollback_statement;
DEALLOCATE PREPARE pos_rollback_statement;

DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` IN ('pos.view', 'pos.checkout');

DELETE FROM `permissions` WHERE `code` IN ('pos.view', 'pos.checkout');
