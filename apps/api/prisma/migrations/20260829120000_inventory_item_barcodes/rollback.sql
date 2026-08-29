-- DESTRUCTIVE: use only for an intentional rollback of the barcode B1 migration.
-- Remove grants before their permission rows, then remove the Inventory-owned data table.
DELETE FROM `role_permissions`
WHERE `permission_id` IN (
  SELECT `id`
  FROM `permissions`
  WHERE `code` IN (
    'inventory_barcodes.view',
    'inventory_barcodes.manage',
    'inventory_barcodes.resolve'
  )
);

DELETE FROM `permissions`
WHERE `code` IN (
  'inventory_barcodes.view',
  'inventory_barcodes.manage',
  'inventory_barcodes.resolve'
);

DROP TABLE `inventory_item_barcodes`;
