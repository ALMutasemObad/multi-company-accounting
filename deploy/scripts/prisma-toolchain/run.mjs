import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

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
// binaryTarget alone can silently default to Debian/OpenSSL 1.1 when detection
// fails. Require the underlying Linux observations before accepting that target.
if (platformInfo.platform === "linux") {
  if (!["1.0.x", "1.1.x", "3.0.x"].includes(platformInfo.libssl)) {
    throw new Error("TOOLCHAIN_OPENSSL_ABI_UNKNOWN: refusing Prisma's default target without launching or downloading an engine");
  }
  if (!["debian", "rhel", "musl"].includes(platformInfo.targetDistro)) {
    throw new Error("TOOLCHAIN_LINUX_ABI_UNKNOWN: a verified deployment platform is required");
  }
}
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
