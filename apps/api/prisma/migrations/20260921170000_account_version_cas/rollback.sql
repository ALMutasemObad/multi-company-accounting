-- Monotonic-safety rollback: intentionally retain accounts.version.
-- Older binaries that do not enforce Account CAS must not be restored; deploy a
-- compatible writer instead. Keeping the column preserves every issued version.
SET @account_version_column_count = (
  SELECT COUNT(*)
  FROM `information_schema`.`COLUMNS`
  WHERE `TABLE_SCHEMA` = DATABASE()
    AND `TABLE_NAME` = 'accounts'
    AND `COLUMN_NAME` = 'version'
);
SET @account_version_rollback_sql = IF(
  @account_version_column_count = 1,
  'SELECT 1',
  'SIGNAL SQLSTATE ''45000'' SET MESSAGE_TEXT = ''Account.version must be retained for monotonic CAS safety'''
);
PREPARE account_version_rollback_statement FROM @account_version_rollback_sql;
EXECUTE account_version_rollback_statement;
DEALLOCATE PREPARE account_version_rollback_statement;
