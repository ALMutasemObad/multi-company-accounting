import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { assertVerifiedLinuxPlatform } from "./platform-policy.mjs";

// This tree is installed from its own lock at build time and covered by the
// release manifest. Never resolve a CLI from PATH, npm's cache or the app tree.
const root = path.dirname(fileURLToPath(import.meta.url));
const modules = realpathSync(path.join(root, "node_modules"));
const entry = path.join(modules, "prisma/build/index.js");
const requireFromCli = createRequire(entry);
for (const [name, expected] of [["prisma", "7.9.1"], ["mysql2", "3.23.1"], ["@prisma/engines", "7.9.1"]]) {
  const file = realpathSync(requireFromCli.resolve(`${name}/package.json`));
  if (!file.startsWith(`${modules}${path.sep}`)) throw new Error(`External toolchain dependency: ${name}`);
  if (JSON.parse(readFileSync(file, "utf8")).version !== expected) {
    throw new Error(`Unapproved toolchain dependency: ${name}`);
  }
}
const engineRoot = path.dirname(requireFromCli.resolve("@prisma/engines/package.json"));
const requireFromEngines = createRequire(path.join(engineRoot, "package.json"));
const platformModule = realpathSync(requireFromEngines.resolve("@prisma/get-platform"));
if (!platformModule.startsWith(`${modules}${path.sep}`)) throw new Error("External platform resolver is forbidden");
const { getPlatformInfo } = requireFromEngines(platformModule);
const platformInfo = await getPlatformInfo();
// binaryTarget alone can silently fall back when detection fails. Require the
// underlying distro or runtime ABI observations before accepting that target.
assertVerifiedLinuxPlatform(platformInfo, process.report?.getReport()?.header);
const target = platformInfo.binaryTarget;
const expectedEngine = `schema-engine-${target}${process.platform === "win32" ? ".exe" : ""}`;
const engines = readdirSync(engineRoot, { withFileTypes: true })
  .filter((item) => item.isFile() && /^schema-engine-/u.test(item.name));
if (engines.length !== 1) throw new Error("Exactly one packaged schema engine is required");
if (engines[0].name !== expectedEngine) throw new Error(`Packaged schema engine does not match platform: ${target}`);
const engine = realpathSync(path.join(engineRoot, engines[0].name));
if (!engine.startsWith(`${modules}${path.sep}`)) throw new Error("External schema engine is forbidden");
const args = process.argv.slice(2);
const command = args.join(" ");
if (!["--version", "validate", "migrate deploy", "migrate status"].includes(command)) {
  throw new Error("Only version, validation and deployment migration commands are allowed");
}
const childEnvironment = {
  ...process.env,
  CHECKPOINT_DISABLE: "1",
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
  // An explicit, present binary prevents Prisma's download fallback on the host.
  PRISMA_SCHEMA_ENGINE_BINARY: engine,
};
delete childEnvironment.PRISMA_MIGRATION_ENGINE_BINARY;
const result = spawnSync(process.execPath, [entry, ...args], {
  stdio: "inherit",
  // Version preflight must not load a caller's database configuration.
  cwd: command === "--version" ? root : process.cwd(),
  env: childEnvironment,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
