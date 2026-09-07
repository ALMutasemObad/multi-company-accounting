const supportedOpenSslAbis = new Set(["1.0.x", "1.1.x", "3.0.x"]);
const recognizedDistros = new Set(["debian", "rhel", "musl"]);
const approvedReleaseEngines = new Set([
  "schema-engine-debian-openssl-1.1.x",
  "schema-engine-debian-openssl-3.0.x",
]);

export function assertVerifiedLinuxPlatform(platformInfo, runtimeHeader = {}) {
  if (platformInfo.platform !== "linux") return;
  if (!supportedOpenSslAbis.has(platformInfo.libssl)) {
    throw new Error("TOOLCHAIN_OPENSSL_ABI_UNKNOWN: refusing Prisma's default target without launching or downloading an engine");
  }
  if (recognizedDistros.has(platformInfo.targetDistro)) return;

  // CloudLinux can hide its RHEL ancestry from /etc/os-release inside the
  // application selector. Accept Prisma's glibc fallback only when the host
  // itself proves every ABI input used by the packaged engine.
  const glibc = runtimeHeader.glibcVersionRuntime;
  const verifiedGlibcFallback = platformInfo.arch === "x64"
    && platformInfo.archFromUname === "x86_64"
    && typeof glibc === "string"
    && /^\d+\.\d+(?:\.\d+)?$/u.test(glibc)
    && platformInfo.binaryTarget === `debian-openssl-${platformInfo.libssl}`;
  if (!verifiedGlibcFallback) {
    throw new Error("TOOLCHAIN_LINUX_ABI_UNKNOWN: a verified deployment platform is required");
  }
}

export function selectPackagedEngineName(engineNames, expectedEngine) {
  if (engineNames.length === 0 || engineNames.length > 2) {
    throw new Error("One or two packaged schema engines are required");
  }
  if (engineNames.length > 1 && engineNames.some((name) => !approvedReleaseEngines.has(name))) {
    throw new Error("Unapproved packaged schema engine");
  }
  if (!engineNames.includes(expectedEngine)) {
    throw new Error(`Packaged schema engine does not match platform: ${expectedEngine.replace(/^schema-engine-/u, "")}`);
  }
  return expectedEngine;
}
