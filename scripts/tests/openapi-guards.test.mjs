import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { z } from "zod";
import {
  buildGeneratedSource,
  contractPath,
  generatedPath,
  guardedOperationIds,
  responseOperationIds,
} from "../generate-openapi-guards.mjs";

test("generated OpenAPI guards are committed and current", () => {
  assert.equal(guardedOperationIds.length, 167);
  assert.equal(responseOperationIds.length, 317);
  assert.ok(responseOperationIds.includes("getCompanySubscriptionUsage"));
  assert.ok(guardedOperationIds.includes("setPlatformSubscriptionPublicListing"));
  assert.ok(responseOperationIds.includes("listPublicSubscriptionPlans"));
  assert.ok(responseOperationIds.includes("getCurrentAuthorization"));
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
  assert.ok(guardedOperationIds.includes("upsertPlatformBillingAccount"));
  assert.ok(guardedOperationIds.includes("issuePlatformBillingInvoice"));
  assert.ok(guardedOperationIds.includes("publishPlatformSubscriptionPlanVersion"));
  assert.ok(guardedOperationIds.includes("requestCompanySubscriptionChange"));
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
  assert.match(generated, /openApiContractCoverage = \{ operations: 317, requestBodies: 167, responseBodies: 2101 \}/u);
  assert.match(generated, /"receivableItemId": z\.string\(\).*\.transform\(\(value\) => BigInt\(value\)\)/u);
  assert.match(generated, /export const openApiResponseBodySchemas = \{/u);
});

test("guard generation is stable across LF and CRLF checkouts", () => {
  const source = readFileSync(contractPath, "utf8").replace(/\r\n?/gu, "\n");
  assert.equal(buildGeneratedSource(source), buildGeneratedSource(source.replace(/\n/gu, "\r\n")));
});

test("allOf preserves each strict constituent before applying request transformations", () => {
  const requestShape = {
    type: "object", required: ["id"], additionalProperties: false,
    properties: { id: { type: "string", pattern: "^[1-9][0-9]*$" } },
  };
  const responseShape = {
    type: "object", required: ["count"], additionalProperties: false,
    properties: { count: { type: "integer", minimum: 0 } },
  };
  const generated = buildGeneratedSource(JSON.stringify({
    openapi: "3.1.0", components: { schemas: {} },
    paths: { "/probe": { post: {
      operationId: "probe",
      requestBody: { required: true, content: { "application/json": { schema: {
        allOf: [requestShape, { type: "object", properties: requestShape.properties }],
      } } } },
      responses: { "200": { description: "Probe", content: { "application/json": { schema: {
        allOf: [responseShape, { type: "object", properties: responseShape.properties }],
      } } } } },
    } } },
  }));
  // Execute only generated schema expressions, not a hand-copied equivalent. The
  // synthetic fixture has no component references, defaults, or optional fields.
  const requestExpression = generated.match(/export const openApiRequestBodySchemas = ([\s\S]*?) as const;/u)?.[1];
  const responseExpression = generated.match(/export const openApiResponseBodySchemas = ([\s\S]*?) as const;/u)?.[1];
  assert.ok(requestExpression);
  assert.ok(responseExpression);
  const requestSchemas = new Function("z", "compactRequestBody", `return (${requestExpression});`)(z, (value) => value);
  const responseSchemas = new Function("z", `return (${responseExpression});`)(z);
  assert.deepEqual(requestSchemas.probe.parse({ id: "9007199254740993" }), { id: 9007199254740993n });
  assert.equal(requestSchemas.probe.safeParse({ id: "1", secret: "not allowed" }).success, false);
  assert.equal(requestSchemas.probe.safeParse({ id: 1 }).success, false);
  assert.deepEqual(responseSchemas.probe["200"].parse({ count: 1 }), { count: 1 });
  assert.equal(responseSchemas.probe["200"].safeParse({ count: 1, secret: "not allowed" }).success, false);
});
