import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

const npmCli = process.env.npm_execpath;
if (!npmCli || !path.isAbsolute(npmCli)) throw new Error("Run runtime:prune through the pinned npm CLI");
const invoke = (args, options = {}) => spawnSync(process.execPath, [npmCli, ...args], {
  cwd: process.cwd(), encoding: "utf8", maxBuffer: 16 * 1024 * 1024, windowsHide: true, ...options,
});
const version = invoke(["--version"]);
if (version.error || version.status !== 0 || version.stdout.trim() !== "12.0.2") {
  throw new Error("npm 12.0.2 is required for runtime pruning");
}

const lockPath = path.join(process.cwd(), "package-lock.json");
const originalLock = readFileSync(lockPath);
// The optional Prisma generator peer makes its development dependency tree
// devOptional. Omit only development edges here, rather than all optional
// dependencies (which would remove Sharp's native runtime bindings). This flag
// is deliberately scoped to pruning, not dependency installation. The complete
// peer graph is checked immediately afterwards and must still be valid.
const prune = invoke(["prune", "--omit=dev", "--legacy-peer-deps", "--no-save"], { stdio: "inherit" });
if (prune.error || prune.status !== 0) throw new Error("Production runtime pruning failed");
if (!originalLock.equals(readFileSync(lockPath))) throw new Error("Runtime pruning changed the source lockfile");
for (const dependency of ["prisma", "tsx", "typescript", "vitest"]) {
  if (existsSync(path.join(process.cwd(), "node_modules", dependency))) {
    throw new Error(`Build-only dependency remains in runtime: ${dependency}`);
  }
}
const graph = invoke(["ls", "--omit=dev", "--all", "--json"]);
if (graph.error || graph.status !== 0) {
  if (graph.stdout) process.stderr.write(graph.stdout);
  if (graph.stderr) process.stderr.write(graph.stderr);
  throw new Error("Production runtime dependency and peer graph is invalid");
}
process.stdout.write("Production runtime graph verified; source lockfile unchanged.\n");
