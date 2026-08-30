import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relativePath) => readFileSync(path.join(projectRoot, relativePath), "utf8");

for (const [context, relativePath] of [
  ["sales", "apps/web/src/SalesInvoicesPage.tsx"],
  ["purchases", "apps/web/src/PurchaseInvoicesPage.tsx"],
]) {
  test(`${context} invoices retain shared, permission-aware barcode scanning`, () => {
    const source = read(relativePath);
    assert.match(source, /<InventoryBarcodeScanner/u);
    assert.match(source, /canUseInventoryBarcodeScanner\(permissionSet, operationPolicy\)/u);
    assert.match(source, /maxLines=\{200\}/u);
    assert.match(source, /applyResolvedBarcodeToLines\(linesRef\.current/u);
    assert.doesNotMatch(source, /api<ResolvedInventoryBarcode>\("\/inventory-barcodes\/resolve"/u);
  });
}

test("invoice scanners retain the tenant-isolated OpenAPI resolve boundary and line limits", () => {
  const scanner = read("apps/web/src/InventoryBarcodeScanner.tsx");
  assert.match(scanner, /"\/inventory-barcodes\/resolve"/u);
  assert.match(scanner, /body: JSON\.stringify\(\{ value: entry\.value \}\)/u);

  const contract = read("packages/contracts/openapi.yaml");
  const operation = contract.slice(
    contract.indexOf("/inventory-barcodes/resolve:"),
    contract.indexOf("/inventory-barcodes/resolve-batch:"),
  );
  assert.match(operation, /x-permission: inventory_barcodes\.resolve/u);

  for (const [start, end] of [
    ["SalesInvoiceCreateRequest:", "SalesInvoiceUpdateRequest:"],
    ["PurchaseInvoiceCreateRequest:", "PurchaseInvoiceUpdateRequest:"],
  ]) {
    const request = contract.slice(contract.indexOf(start), contract.indexOf(end));
    assert.match(request, /maxItems: 200/u);
  }
});
