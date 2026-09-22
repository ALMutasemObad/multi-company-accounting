-- Create neutral public CODE_128 identifiers for legacy active catalog items that
-- do not yet have a primary barcode. These are labels, not claimed ISBN values.
INSERT INTO `inventory_item_barcodes` (
  `company_id`, `inventory_item_id`, `symbology`, `value`, `normalized_value`,
  `is_primary`, `primary_inventory_item_id`, `is_active`, `version`, `created_at`, `updated_at`
)
SELECT
  item.`company_id`, item.`id`, 'CODE_128',
  CONCAT('BK-', UPPER(SUBSTRING(SHA2(CONCAT('INVENTORY-PUBLIC-BARCODE:', item.`company_id`, ':', item.`id`), 256), 1, 16))),
  CONCAT('BK-', UPPER(SUBSTRING(SHA2(CONCAT('INVENTORY-PUBLIC-BARCODE:', item.`company_id`, ':', item.`id`), 256), 1, 16))),
  TRUE, item.`id`, TRUE, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3)
FROM `inventory_items` item
WHERE item.`is_active` = TRUE
  AND NOT EXISTS (
    SELECT 1 FROM `inventory_item_barcodes` barcode
    WHERE barcode.`company_id` = item.`company_id`
      AND barcode.`inventory_item_id` = item.`id`
      AND barcode.`is_primary` = TRUE
  );
