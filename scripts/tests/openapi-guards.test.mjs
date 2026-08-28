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
  assert.equal(guardedOperationIds.length, 144);
  assert.equal(responseOperationIds.length, 271);
  assert.ok(guardedOperationIds.includes("linkUserEmployee"));
  assert.ok(guardedOperationIds.includes("createManualJournal"));
  assert.ok(guardedOperationIds.includes("createReceipt"));
  assert.ok(guardedOperationIds.includes("updatePaymentMethod"));
  assert.ok(guardedOperationIds.includes("createWarehouse"));
  assert.ok(guardedOperationIds.includes("createUnitOfMeasure"));
  assert.ok(guardedOperationIds.includes("createInventoryItem"));
  assert.ok(guardedOperationIds.includes("createInventoryMovement"));
  assert.ok(guardedOperationIds.includes("initializeInventoryBalanceValuation"));
  assert.ok(guardedOperationIds.includes("reverseInventoryMovement"));
  assert.ok(guardedOperationIds.includes("commitDataImport"));
  assert.ok(guardedOperationIds.includes("commitBankStatementImport"));
  assert.ok(guardedOperationIds.includes("closeBankReconciliationSession"));
  assert.ok(guardedOperationIds.includes("startFinancialCloseRun"));
  assert.ok(guardedOperationIds.includes("createApprovalRequest"));
  assert.ok(guardedOperationIds.includes("approveApprovalRequest"));
  assert.ok(guardedOperationIds.includes("updateCashFlowMapping"));
  assert.ok(guardedOperationIds.includes("completePosCheckout"));
  assert.ok(guardedOperationIds.includes("createProfessionalProject"));
  assert.ok(guardedOperationIds.includes("createProfessionalTimeEntry"));
  assert.ok(guardedOperationIds.includes("createProfessionalTimesheet"));
  assert.ok(guardedOperationIds.includes("createProfessionalServiceContract"));
  assert.ok(guardedOperationIds.includes("createProfessionalServiceRate"));
  assert.ok(guardedOperationIds.includes("createProfessionalBillingRun"));
  assert.ok(guardedOperationIds.includes("updateProfessionalProjectAccess"));
  assert.ok(guardedOperationIds.includes("grantProfessionalProjectAccess"));
  assert.ok(guardedOperationIds.includes("revokeProfessionalProjectAccess"));
  assert.ok(guardedOperationIds.includes("createProfessionalProjectStage"));
  assert.ok(guardedOperationIds.includes("createProfessionalProjectTask"));
  assert.ok(guardedOperationIds.includes("transitionProfessionalProjectTask"));
  assert.ok(guardedOperationIds.includes("createProfessionalProjectTaskDependency"));
  assert.ok(guardedOperationIds.includes("createEmployee"));
  assert.ok(guardedOperationIds.includes("transitionEmployee"));
  assert.ok(guardedOperationIds.includes("createEmploymentContract"));
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
  assert.match(generated, /openApiContractCoverage = \{ operations: 271, requestBodies: 144, responseBodies: 1782 \}/u);
  assert.match(generated, /"receivableItemId": z\.string\(\).*\.transform\(\(value\) => BigInt\(value\)\)/u);
  assert.match(generated, /export const openApiResponseBodySchemas = \{/u);
});

test("guard generation is stable across LF and CRLF checkouts", () => {
  const source = readFileSync(contractPath, "utf8").replace(/\r\n?/gu, "\n");
  assert.equal(buildGeneratedSource(source), buildGeneratedSource(source.replace(/\n/gu, "\r\n")));
});
