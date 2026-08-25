import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGeneratedSource,
  contractPath,
  generatedPath,
  guardedOperationIds,
  responseOperationIds,
} from "../generate-openapi-guards.mjs";

test("generated OpenAPI guards are committed and current", () => {
  assert.equal(guardedOperationIds.length, 89);
  assert.equal(responseOperationIds.length, 174);
  assert.ok(guardedOperationIds.includes("createManualJournal"));
  assert.ok(guardedOperationIds.includes("createReceipt"));
  assert.ok(guardedOperationIds.includes("updatePaymentMethod"));
  assert.ok(guardedOperationIds.includes("createWarehouse"));
  assert.ok(guardedOperationIds.includes("createUnitOfMeasure"));
  assert.ok(guardedOperationIds.includes("createInventoryItem"));
  assert.ok(guardedOperationIds.includes("createInventoryMovement"));
  assert.ok(guardedOperationIds.includes("commitDataImport"));
  assert.equal(
    readFileSync(generatedPath, "utf8").replace(/\r\n?/gu, "\n"),
    buildGeneratedSource().replace(/\r\n?/gu, "\n"),
  );
});

test("guard generation reflects request constraints from the contract", () => {
  const source = readFileSync(contractPath, "utf8");
  const changed = source.replace(
    /          maxLength: 320\r?\n        password:/u,
    "          maxLength: 319\n        password:",
  );
  assert.notEqual(changed, source);
  const generated = buildGeneratedSource(changed);
  assert.match(generated, /"email": z\.string\(\)\.email\(\)\.max\(319\)/u);
});

test("guard generation covers request transforms and response schemas", () => {
  const generated = buildGeneratedSource();
  assert.match(generated, /openApiContractCoverage = \{ operations: 174, requestBodies: 89, responseBodies: 1210 \}/u);
  assert.match(generated, /"receivableItemId": z\.string\(\).*\.transform\(\(value\) => BigInt\(value\)\)/u);
  assert.match(generated, /export const openApiResponseBodySchemas = \{/u);
});

test("guard generation is stable across LF and CRLF checkouts", () => {
  const source = readFileSync(contractPath, "utf8").replace(/\r\n?/gu, "\n");
  assert.equal(buildGeneratedSource(source), buildGeneratedSource(source.replace(/\n/gu, "\r\n")));
});
