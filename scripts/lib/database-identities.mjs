const REQUIRED_DML_PRIVILEGES = ["SELECT", "INSERT", "UPDATE", "DELETE"];
const FORBIDDEN_RUNTIME_PRIVILEGES = [
  "ALL",
  "ALL PRIVILEGES",
  "ALTER",
  "ALTER ROUTINE",
  "CREATE",
  "CREATE ROUTINE",
  "CREATE TEMPORARY TABLES",
  "CREATE VIEW",
  "DROP",
  "EVENT",
  "EXECUTE",
  "INDEX",
  "REFERENCES",
  "TRIGGER",
];
const REQUIRED_MIGRATION_PRIVILEGES = [
  ...REQUIRED_DML_PRIVILEGES,
  "CREATE",
  "ALTER",
  "DROP",
  "INDEX",
  "REFERENCES",
];

export class DatabaseIdentityPolicyError extends Error {
  constructor(code) {
    super(code);
    this.name = "DatabaseIdentityPolicyError";
    this.code = code;
  }
}

const normalizeScope = (value) => value
  .replaceAll("`", "")
  .replaceAll("\\_", "_")
  .replaceAll("\\%", "%")
  .trim()
  .toUpperCase();

export const collectApplicablePrivileges = (grantStatements, database) => {
  const targetScope = `${database}.*`.toUpperCase();
  const privileges = new Set();
  for (const statement of grantStatements) {
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s+/iu.exec(statement.trim());
    if (!match) continue;
    const scope = normalizeScope(match[2]);
    if (scope !== "*.*" && scope !== targetScope) continue;
    for (const privilege of match[1].split(",")) privileges.add(privilege.trim().toUpperCase());
  }
  return privileges;
};

const includesPrivilege = (privileges, privilege) =>
  privileges.has("ALL") || privileges.has("ALL PRIVILEGES") || privileges.has(privilege);

const missingPrivileges = (privileges, required) =>
  required.filter((privilege) => !includesPrivilege(privileges, privilege));

export const verifyDatabaseIdentityPolicy = ({
  runtimeConnection,
  migrationConnection,
  runtimeIdentity,
  migrationIdentity,
  runtimeGrants,
  migrationGrants,
}) => {
  const sameEndpoint = runtimeConnection.host.toLowerCase() === migrationConnection.host.toLowerCase()
    && runtimeConnection.port === migrationConnection.port;
  if (!sameEndpoint || runtimeConnection.database !== migrationConnection.database) {
    throw new DatabaseIdentityPolicyError("DATABASE_TARGET_MISMATCH");
  }
  if (runtimeIdentity === migrationIdentity) {
    throw new DatabaseIdentityPolicyError("DATABASE_IDENTITIES_NOT_DISTINCT");
  }

  const runtimePrivileges = collectApplicablePrivileges(runtimeGrants, runtimeConnection.database);
  if (missingPrivileges(runtimePrivileges, REQUIRED_DML_PRIVILEGES).length > 0) {
    throw new DatabaseIdentityPolicyError("RUNTIME_DML_PRIVILEGES_MISSING");
  }
  if (FORBIDDEN_RUNTIME_PRIVILEGES.some((privilege) => runtimePrivileges.has(privilege))) {
    throw new DatabaseIdentityPolicyError("RUNTIME_DDL_PRIVILEGES_PRESENT");
  }

  const migrationPrivileges = collectApplicablePrivileges(migrationGrants, migrationConnection.database);
  if (missingPrivileges(migrationPrivileges, REQUIRED_MIGRATION_PRIVILEGES).length > 0) {
    throw new DatabaseIdentityPolicyError("MIGRATION_PRIVILEGES_MISSING");
  }

  return {
    status: "verified",
    sameDatabase: true,
    distinctIdentities: true,
    runtime: {
      requiredDmlPrivileges: REQUIRED_DML_PRIVILEGES,
      forbiddenDdlPrivilegesPresent: [],
    },
    migration: {
      requiredPrivilegesVerified: REQUIRED_MIGRATION_PRIVILEGES,
    },
  };
};
