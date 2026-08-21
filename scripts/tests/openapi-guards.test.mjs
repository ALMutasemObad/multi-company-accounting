import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildGeneratedSource,
  contractPath,
  generatedPath,
  guardedOperationIds,
} from "../generate-openapi-guards.mjs";

test("generated OpenAPI guards are committed and current", () => {
  assert.deepEqual(guardedOperationIds, [
    "login",
    "startSelfRegistration",
    "resendSelfRegistrationVerification",
    "verifySelfRegistration",
    "selectCompanyContext",
    "updateCurrentCompany",
    "replaceCompanySettings",
    "createCompanyCurrency",
    "replaceCompanyCurrencies",
    "upsertCompanyExchangeRate",
  ]);
  assert.equal(readFileSync(generatedPath, "utf8"), buildGeneratedSource());
});

test("guard generation reflects request constraints from the contract", () => {
  const source = readFileSync(contractPath, "utf8");
  const changed = source.replace("          maxLength: 320\n        password:", "          maxLength: 319\n        password:");
  assert.notEqual(changed, source);
  const generated = buildGeneratedSource(changed);
  assert.match(generated, /"email": z\.string\(\)\.email\(\)\.max\(319\)/u);
});
