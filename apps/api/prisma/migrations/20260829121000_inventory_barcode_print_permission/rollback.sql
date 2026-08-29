-- DESTRUCTIVE: removes the B2 barcode label permission and its role grants.
DELETE `role_permissions`
FROM `role_permissions`
JOIN `permissions` ON `permissions`.`id` = `role_permissions`.`permission_id`
WHERE `permissions`.`code` = 'inventory_barcodes.print';

DELETE FROM `permissions`
WHERE `code` = 'inventory_barcodes.print';
