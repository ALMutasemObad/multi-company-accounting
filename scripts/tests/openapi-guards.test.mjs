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
    "startPasswordReset",
    "completePasswordReset",
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
  const changed = source.replace(
    /          maxLength: 320\r?\n        password:/u,
    "          maxLength: 319\n        password:",
  );
  assert.notEqual(changed, source);
  const generated = buildGeneratedSource(changed);
  assert.match(generated, /"email": z\.string\(\)\.email\(\)\.max\(319\)/u);
});

test("guard generation is stable across LF and CRLF checkouts", () => {
  const source = readFileSync(contractPath, "utf8").replace(/\r\n?/gu, "\n");
  assert.equal(buildGeneratedSource(source), buildGeneratedSource(source.replace(/\n/gu, "\r\n")));
});
