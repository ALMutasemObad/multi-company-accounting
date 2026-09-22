DROP TABLE IF EXISTS `stock_count_entries`;

ALTER TABLE `inventory_items`
  DROP COLUMN `edition`,
  DROP COLUMN `publication_year`,
  DROP COLUMN `publisher`,
  DROP COLUMN `author`;
