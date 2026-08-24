import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const safeDatabaseName = /^[A-Za-z0-9_]+$/;

export const parseMysqlUrl = (rawValue) => {
  if (!rawValue) throw new Error("DATABASE_URL is required");
  const url = new URL(rawValue);
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use the mysql protocol");
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!safeDatabaseName.test(database)) throw new Error("DATABASE_URL must contain a safe database name");
  if (!user) throw new Error("DATABASE_URL must contain a database user");
  if ([url.hostname, user, password].some((value) => /[\r\n\0]/.test(value))) {
    throw new Error("DATABASE_URL contains unsupported control characters");
  }
  return {
    host: url.hostname,
    port: url.port || "3306",
    user,
    password,
    database,
  };
};

const quoteOptionValue = (value) =>
  `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;

export const withMysqlDefaultsFile = async (connection, callback) => {
  const directory = await mkdtemp(join(tmpdir(), "mcap-mysql-"));
  const filePath = join(directory, "client.cnf");
  const content = [
    "[client]",
    `host=${quoteOptionValue(connection.host)}`,
    `port=${quoteOptionValue(connection.port)}`,
    `user=${quoteOptionValue(connection.user)}`,
    `password=${quoteOptionValue(connection.password)}`,
    "default-character-set=utf8mb4",
    "",
  ].join("\n");
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    return await callback(filePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

export const runMysqlScalar = (binary, defaultsFile, database, sql) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        `--defaults-extra-file=${defaultsFile}`,
        "--batch",
        "--skip-column-names",
        database,
        "--execute",
        sql,
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 64 * 1024) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16 * 1024) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`MySQL command failed (${code}): ${stderr.trim() || "no diagnostic output"}`));
    });
  });

export const collectDatabaseVerification = async (binary, defaultsFile, database) => {
  const rowCounts = JSON.parse(await runMysqlScalar(
    binary,
    defaultsFile,
    database,
    `SELECT JSON_OBJECT(
      'organizations', (SELECT COUNT(*) FROM organizations),
      'companies', (SELECT COUNT(*) FROM companies),
      'users', (SELECT COUNT(*) FROM users),
      'accountingDocuments', (SELECT COUNT(*) FROM accounting_documents),
      'journalEntries', (SELECT COUNT(*) FROM journal_entries),
      'journalLines', (SELECT COUNT(*) FROM journal_lines),
      'printArchives', (SELECT COUNT(*) FROM document_print_archives)
    )`,
  ));
  const totals = (await runMysqlScalar(
    binary,
    defaultsFile,
    database,
    `SELECT
      COALESCE(CAST(SUM(base_debit_amount) AS CHAR), '0'),
      COALESCE(CAST(SUM(base_credit_amount) AS CHAR), '0')
    FROM journal_lines`,
  )).split("\t");
  if (totals.length !== 2) throw new Error("Database verification query returned an unexpected result");
  return { rowCounts, journalTotals: { baseDebit: totals[0], baseCredit: totals[1] } };
};

export const waitForChild = (child, label) =>
  new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < 16 * 1024) stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed (${code}): ${stderr.trim() || "no diagnostic output"}`));
    });
  });
