import "dotenv/config";
import { createDatabase } from "../database.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const expectedPrefix = process.env.EXPECTED_DATABASE_VERSION_PREFIX;
const prisma = createDatabase(databaseUrl);

try {
  const rows = await prisma.$queryRawUnsafe<Array<{ version: string; comment: string }>>(
    "SELECT VERSION() AS version, @@version_comment AS comment",
  );
  const database = rows[0];
  if (!database) throw new Error("Database version query returned no rows");
  if (expectedPrefix && !database.version.startsWith(expectedPrefix)) {
    throw new Error(`Expected database version prefix ${expectedPrefix}, received ${database.version}`);
  }
  process.stdout.write(`${JSON.stringify({ status: "ready", ...database })}\n`);
} finally {
  await prisma.$disconnect();
}
