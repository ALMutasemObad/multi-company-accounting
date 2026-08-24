import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DatabaseIdentityPolicyError,
  collectApplicablePrivileges,
  verifyDatabaseIdentityPolicy,
} from "../lib/database-identities.mjs";
import { parseMysqlUrl } from "../lib/mysql-tools.mjs";

const runtimeConnection = {
  host: "database.example",
  port: "3306",
  database: "mcap_finance",
};
const migrationConnection = { ...runtimeConnection };
const runtimeGrants = [
  "GRANT USAGE ON *.* TO `runtime`@`%`",
  "GRANT SELECT, INSERT, UPDATE, DELETE ON `mcap_finance`.* TO `runtime`@`%`",
];
const migrationGrants = [
  "GRANT ALL PRIVILEGES ON `mcap_finance`.* TO `migration`@`%`",
];

const verify = (overrides = {}) => verifyDatabaseIdentityPolicy({
  runtimeConnection,
  migrationConnection,
  runtimeIdentity: "runtime@%",
  migrationIdentity: "migration@%",
  runtimeGrants,
  migrationGrants,
  ...overrides,
});

test("grant parsing includes only global and selected-schema privileges", () => {
  const privileges = collectApplicablePrivileges([
    ...runtimeGrants,
    "GRANT CREATE ON `another_database`.* TO `runtime`@`%`",
    "GRANT `unrelated_role`@`%` TO `runtime`@`%`",
  ], "mcap_finance");
  assert.deepEqual([...privileges].sort(), ["DELETE", "INSERT", "SELECT", "UPDATE", "USAGE"]);
});

test("grant parsing accepts escaped wildcard characters emitted by cPanel MariaDB in batch mode", () => {
  const privileges = collectApplicablePrivileges([
    "GRANT USAGE ON *.* TO `runtime`@`%`",
    "GRANT SELECT, INSERT, UPDATE, DELETE ON `mcap\\\\_finance`.* TO `runtime`@`%`",
  ], "mcap_finance");

  assert.deepEqual([...privileges].sort(), ["DELETE", "INSERT", "SELECT", "UPDATE", "USAGE"]);
});

test("database identity policy accepts DML-only runtime and DDL-capable migration accounts", () => {
  assert.deepEqual(verify(), {
    status: "verified",
    sameDatabase: true,
    distinctIdentities: true,
    runtime: {
      requiredDmlPrivileges: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      forbiddenDdlPrivilegesPresent: [],
    },
    migration: {
      requiredPrivilegesVerified: [
        "SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "INDEX", "REFERENCES",
      ],
    },
  });
});

test("database identity policy fails closed for shared identities or runtime DDL", () => {
  assert.throws(
    () => verify({ migrationIdentity: "runtime@%" }),
    (error) => error instanceof DatabaseIdentityPolicyError
      && error.code === "DATABASE_IDENTITIES_NOT_DISTINCT",
  );
  assert.throws(
    () => verify({
      runtimeGrants: ["GRANT SELECT, INSERT, UPDATE, DELETE, CREATE ON `mcap_finance`.* TO `runtime`@`%`"],
    }),
    (error) => error instanceof DatabaseIdentityPolicyError
      && error.code === "RUNTIME_DDL_PRIVILEGES_PRESENT",
  );
});

test("database identity policy rejects target drift and incomplete migration grants", () => {
  assert.throws(
    () => verify({ migrationConnection: { ...migrationConnection, database: "other" } }),
    (error) => error instanceof DatabaseIdentityPolicyError
      && error.code === "DATABASE_TARGET_MISMATCH",
  );
  assert.throws(
    () => verify({ migrationGrants: runtimeGrants }),
    (error) => error instanceof DatabaseIdentityPolicyError
      && error.code === "MIGRATION_PRIVILEGES_MISSING",
  );
});

test("MySQL URLs reject percent-encoded control characters after decoding", () => {
  assert.throws(
    () => parseMysqlUrl("mysql://runtime%0Auser:password@127.0.0.1:3306/mcap_finance"),
    /control characters/u,
  );
});
