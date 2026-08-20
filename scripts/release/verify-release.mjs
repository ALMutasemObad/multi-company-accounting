import path from "node:path";
import process from "node:process";
import { verifyRelease } from "../lib/release-manifest.mjs";

const argumentsList = process.argv.slice(2);
const rootIndex = argumentsList.indexOf("--root");
if (rootIndex < 0 || !argumentsList[rootIndex + 1]) {
  process.stderr.write("Usage: node scripts/release/verify-release.mjs --root <release-directory>\n");
  process.exit(2);
}

verifyRelease(path.resolve(argumentsList[rootIndex + 1]))
  .then((result) => process.stdout.write(`${JSON.stringify({ status: "verified", ...result })}\n`))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
