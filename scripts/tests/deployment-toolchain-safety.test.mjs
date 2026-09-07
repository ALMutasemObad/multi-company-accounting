import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { deflateSync } from "node:zlib";
import { test } from "node:test";
import { assertVerifiedLinuxPlatform, selectPackagedEngineName } from "../../deploy/scripts/prisma-toolchain/platform-policy.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const toolchain = path.join(root, "deploy/scripts/prisma-toolchain");
const require = createRequire(import.meta.url);

test("migration platform policy accepts a directly observed glibc fallback and rejects incomplete claims", () => {
  const cloudLinuxSelector = {
    platform: "linux",
    arch: "x64",
    archFromUname: "x86_64",
    libssl: "3.0.x",
    binaryTarget: "debian-openssl-3.0.x",
  };
  assert.doesNotThrow(() => assertVerifiedLinuxPlatform(cloudLinuxSelector, { glibcVersionRuntime: "2.28" }));
  assert.throws(
    () => assertVerifiedLinuxPlatform(cloudLinuxSelector, {}),
    /TOOLCHAIN_LINUX_ABI_UNKNOWN/u,
  );
  assert.throws(
    () => assertVerifiedLinuxPlatform({ ...cloudLinuxSelector, binaryTarget: "debian-openssl-1.1.x" }, { glibcVersionRuntime: "2.28" }),
    /TOOLCHAIN_LINUX_ABI_UNKNOWN/u,
  );
});

test("migration platform policy selects only the matching locked OpenSSL engine", () => {
  const engines = ["schema-engine-debian-openssl-1.1.x", "schema-engine-debian-openssl-3.0.x"];
  assert.equal(selectPackagedEngineName(engines, engines[0]), engines[0]);
  assert.equal(selectPackagedEngineName(engines, engines[1]), engines[1]);
  assert.throws(
    () => selectPackagedEngineName([...engines, "schema-engine-rhel-openssl-3.0.x"], engines[0]),
    /One or two packaged schema engines/u,
  );
  assert.throws(
    () => selectPackagedEngineName([engines[0], "schema-engine-unapproved"], engines[0]),
    /Unapproved packaged schema engine/u,
  );
});

test("application and isolated migration lock both resolve the patched mysql2 without upgrading Prisma", async () => {
  for (const directory of [root, toolchain]) {
    const manifest = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    const lock = JSON.parse(await readFile(path.join(directory, "package-lock.json"), "utf8"));
    assert.equal(manifest.overrides.mysql2, "3.23.1");
    assert.equal(lock.packages["node_modules/prisma"].version, "7.9.1");
    assert.equal(lock.packages["node_modules/mysql2"].version, "3.23.1");
    for (const [name, dependency] of Object.entries(lock.packages)) {
      if (name.endsWith("/mysql2")) assert.equal(dependency.version, "3.23.1");
      if (dependency.link || !name) continue;
      // Every registry download is immutable and has integrity recorded.
      if (dependency.resolved) {
        assert.match(dependency.resolved, /^https:\/\/registry\.npmjs\.org\//u);
        assert.match(dependency.integrity, /^sha512-/u);
      }
    }
  }
});

test("packager authenticates the isolated CLI in the release and installer never downloads it", async () => {
  const packager = await readFile(path.join(root, "scripts/release/package-release.sh"), "utf8");
  const installer = await readFile(path.join(root, "deploy/scripts/install-cpanel-release.sh"), "utf8");
  const creator = await readFile(path.join(root, "scripts/release/create-release.mjs"), "utf8");
  assert.match(creator, /"deploy\/scripts"/u);
  assert.ok(packager.indexOf("npm ci --prefix") < packager.indexOf("create-release.mjs"));
  assert.match(packager, /PRISMA_CLI_BINARY_TARGETS=debian-openssl-1\.1\.x,debian-openssl-3\.0\.x/u);
  assert.match(packager, /npm audit --prefix[^\n]+--audit-level=moderate/u);
  assert.match(packager, /roundtrip_root\/deploy\/scripts\/prisma-toolchain\/run.mjs" validate/u);
  assert.doesNotMatch(packager + installer, /\bnpx\b(?! download)|prisma@7\.9\.1 migrate|MCAP_NPX_CLI/u);
  assert.ok(installer.indexOf('verify-release.mjs"') < installer.indexOf('prisma-toolchain/run.mjs" --version'));
  assert.ok(installer.indexOf('prisma-toolchain/run.mjs" --version') < installer.indexOf("verify-database-identities.mjs"));
});

test("migration launcher fails closed and propagates the packaged CLI result", async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), "toolchain-launcher-"));
  const launcher = path.join(fixture, "run.mjs");
  await writeFile(launcher, await readFile(path.join(toolchain, "run.mjs")));
  await writeFile(
    path.join(fixture, "platform-policy.mjs"),
    await readFile(path.join(toolchain, "platform-policy.mjs")),
  );
  const run = (...args) => spawnSync(process.execPath, [launcher, ...args], {
    encoding: "utf8",
    env: { ...process.env, PRISMA_SCHEMA_ENGINE_BINARY: "/untrusted/engine", PRISMA_MIGRATION_ENGINE_BINARY: "/untrusted/engine" },
  });
  assert.notEqual(run("migrate", "deploy").status, 0, "missing isolated dependencies must not fall back to npm");
  await mkdir(path.join(fixture, "node_modules/prisma/build"), { recursive: true });
  await mkdir(path.join(fixture, "node_modules/mysql2"), { recursive: true });
  await mkdir(path.join(fixture, "node_modules/@prisma/engines"), { recursive: true });
  await mkdir(path.join(fixture, "node_modules/@prisma/get-platform"), { recursive: true });
  const platformStub = path.join(fixture, "node_modules/@prisma/get-platform/index.js");
  const setPlatform = (info) => writeFile(platformStub, `exports.getPlatformInfo = async () => (${JSON.stringify(info)});`);
  await setPlatform({ platform: process.platform, binaryTarget: "fixture", libssl: "3.0.x", targetDistro: "debian" });
  await writeFile(path.join(fixture, "node_modules/@prisma/engines/package.json"), JSON.stringify({ name: "@prisma/engines", version: "7.9.1" }));
  await writeFile(path.join(fixture, "node_modules/prisma/package.json"), JSON.stringify({ name: "prisma", version: "7.9.1" }));
  const mysqlManifest = path.join(fixture, "node_modules/mysql2/package.json");
  await writeFile(mysqlManifest, JSON.stringify({ name: "mysql2", version: "3.15.3" }));
  await writeFile(path.join(fixture, "node_modules/prisma/build/index.js"), 'console.log(JSON.stringify({ args: process.argv.slice(2), engine: process.env.PRISMA_SCHEMA_ENGINE_BINARY })); process.exit(23);');
  assert.match(run("migrate", "deploy").stderr, /Unapproved toolchain dependency: mysql2/u);
  await writeFile(mysqlManifest, JSON.stringify({ name: "mysql2", version: "3.23.1" }));
  assert.match(run("migrate", "deploy").stderr, /One or two packaged schema engines are required/u);
  await writeFile(path.join(fixture, `node_modules/@prisma/engines/schema-engine-fixture${process.platform === "win32" ? ".exe" : ""}`), "fixture");
  await setPlatform({ platform: "linux", binaryTarget: "debian-openssl-1.1.x", targetDistro: "debian" });
  const unknownSSL = run("migrate", "deploy");
  assert.equal(unknownSSL.status, 1);
  assert.match(unknownSSL.stderr, /TOOLCHAIN_OPENSSL_ABI_UNKNOWN/u);
  assert.equal(unknownSSL.stdout, "", "unknown SSL must fail before launching the CLI");
  await setPlatform({ platform: "linux", binaryTarget: "debian-openssl-3.0.x", libssl: "3.0.x" });
  assert.match(run("migrate", "deploy").stderr, /TOOLCHAIN_LINUX_ABI_UNKNOWN/u);
  for (const libssl of ["1.0.x", "1.1.x", "3.0.x"]) {
    await setPlatform({ platform: "linux", binaryTarget: "fixture", libssl, targetDistro: "debian" });
    assert.equal(run("migrate", "deploy").status, 23, `detected ${libssl} must reach the packaged CLI`);
  }
  await setPlatform({ platform: process.platform, binaryTarget: "incompatible", libssl: "3.0.x", targetDistro: "debian" });
  assert.match(run("migrate", "deploy").stderr, /does not match platform/u);
  await setPlatform({ platform: process.platform, binaryTarget: "fixture", libssl: "3.0.x", targetDistro: "debian" });
  assert.match(run("studio").stderr, /Only version, validation and deployment migration commands/u);
  assert.match(run("migrate", "deploy", "--config", "other.ts").stderr, /Only version/u);
  const result = run("migrate", "deploy");
  assert.equal(result.status, 23);
  assert.deepEqual(JSON.parse(result.stdout).args, ["migrate", "deploy"]);
  assert.equal(JSON.parse(result.stdout).engine, path.join(fixture, `node_modules/@prisma/engines/schema-engine-fixture${process.platform === "win32" ? ".exe" : ""}`));
});

test("patched driver rejects unrequested cleartext authentication without writing credentials", () => {
  const mysqlRoot = path.dirname(require.resolve("mysql2/package.json", { paths: [root, toolchain] }));
  const { authSwitchRequest } = require(path.join(mysqlRoot, "lib/commands/auth_switch.js"));
  const AuthSwitchRequest = require(path.join(mysqlRoot, "lib/packets/auth_switch_request.js"));
  const packet = new AuthSwitchRequest({ pluginName: "mysql_clear_password", pluginData: Buffer.alloc(0) }).toPacket();
  packet.offset = 4;
  let writes = 0;
  assert.throws(() => authSwitchRequest(packet, {
    config: { password: "synthetic-test-password" },
    writePacket() { writes += 1; },
  }, {}), { code: "MYSQL_CLEAR_PASSWORD_NOT_ENABLED", fatal: true });
  assert.equal(writes, 0);
});

test("patched compression handler rejects output exceeding the declared length using a tiny in-memory fixture", async () => {
  const mysqlRoot = path.dirname(require.resolve("mysql2/package.json", { paths: [root, toolchain] }));
  const { enableCompression } = require(path.join(mysqlRoot, "lib/compressed_protocol.js"));
  const result = await new Promise((resolve, reject) => {
    const connection = {
      write() {},
      _handleNetworkError: resolve,
      _bumpCompressedSequenceId() { reject(new Error("Oversized frame was accepted")); },
    };
    enableCompression(connection);
    connection._handleCompressedPacket({ readInt24: () => 31, readBuffer: () => deflateSync(Buffer.alloc(32)), numPackets: 1 });
  });
  assert.equal(result.code, "ERR_BUFFER_TOO_LARGE");
});
