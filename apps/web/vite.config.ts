import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const workspaceRoot = fileURLToPath(new URL("../..", import.meta.url));
const dependencyRoot = realpathSync(fileURLToPath(new URL("../../node_modules", import.meta.url)));
const localesRoot = fileURLToPath(new URL("./src/i18n/locales", import.meta.url));
const publicManifestId = "virtual:locale-manifest";
const resolvedManifestId = `\0${publicManifestId}`;

type LocaleMetadata = { code: string; nativeName: string; dir: "rtl" | "ltr"; intl: string };

export const uncompressedUtf8Bytes = (source: string) => Buffer.byteLength(source, "utf8");

function localeMetadata(source: string, filename: string): LocaleMetadata {
  const block = source.match(/export\s+const\s+localeMetadata\s*=\s*\{(?<body>[\s\S]*?)\}\s*as\s+const\s*;/u)?.groups?.body;
  if (!block) throw new Error(`${filename} must export localeMetadata as a literal object followed by "as const".`);
  const field = (name: string) => block.match(new RegExp(`(?:^|\\n)\\s*(?:"${name}"|${name})\\s*:\\s*"([^"\\r\\n]*)"\\s*,?`, "u"))?.[1];
  const metadata = {
    code: field("code"),
    nativeName: field("nativeName"),
    dir: field("dir"),
    intl: field("intl"),
  };
  if (!metadata.code || !metadata.nativeName?.trim() || !metadata.dir || !metadata.intl) {
    throw new Error(`${filename} has missing or empty localeMetadata fields.`);
  }
  if (metadata.dir !== "rtl" && metadata.dir !== "ltr") throw new Error(`${filename} localeMetadata.dir must be rtl or ltr.`);
  let canonicalCode: string;
  let canonicalIntl: string;
  try {
    [canonicalCode] = Intl.getCanonicalLocales(metadata.code);
    [canonicalIntl] = Intl.getCanonicalLocales(metadata.intl);
  } catch {
    throw new Error(`${filename} must use valid BCP47 values for code and intl.`);
  }
  if (canonicalCode !== metadata.code || canonicalIntl !== metadata.intl) {
    throw new Error(`${filename} must use canonical BCP47 casing: ${canonicalCode} / ${canonicalIntl}.`);
  }
  if (basename(filename) !== `${metadata.code}.locale.ts`) {
    throw new Error(`${filename} must be named ${metadata.code}.locale.ts to match localeMetadata.code.`);
  }
  return metadata as LocaleMetadata;
}

function discoverLocales() {
  const entries = readdirSync(localesRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".locale.ts"))
    .map((entry) => {
      const filename = resolve(localesRoot, entry.name);
      return { ...localeMetadata(readFileSync(filename, "utf8"), filename), modulePath: `./locales/${entry.name}`, filename };
    })
    .sort((left, right) => left.code === "ar" ? -1 : right.code === "ar" ? 1 : left.code.localeCompare(right.code));
  if (!entries.some(({ code }) => code === "ar")) throw new Error("The required Arabic fallback ar.locale.ts is missing.");
  const duplicate = entries.find((entry, index) => entries.findIndex(({ code }) => code === entry.code) !== index);
  if (duplicate) throw new Error(`Duplicate locale code: ${duplicate.code}`);
  return entries;
}

function localeManifestPlugin(): Plugin {
  return {
    name: "locale-file-manifest",
    resolveId(id) {
      return id === publicManifestId ? resolvedManifestId : undefined;
    },
    load(id) {
      if (id !== resolvedManifestId) return undefined;
      const entries = discoverLocales();
      entries.forEach(({ filename }) => this.addWatchFile(filename));
      const manifest = entries.map(({ filename: _filename, ...entry }) => entry);
      return `export const localeManifest = Object.freeze(${JSON.stringify(manifest)});`;
    },
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
        const localeModules = Object.keys(output.modules).filter((id) => /[/\\]i18n[/\\]locales[/\\][^/\\]+\.locale\.ts$/u.test(id));
        if (localeModules.length > 1) {
          this.error(`Locale dictionaries were merged into ${output.fileName}: ${localeModules.join(", ")}`);
        }
        const outputBytes = uncompressedUtf8Bytes(output.code);
        if (localeModules.length === 1 && outputBytes > 500 * 1024) {
          this.error(`Locale chunk ${output.fileName} exceeds the 500 KiB uncompressed limit.`);
        }
        const legacySharedLocaleModules = Object.keys(output.modules).filter((id) =>
          /[/\\]i18n[/\\]locales[/\\]/u.test(id) && !/\.locale\.ts$/u.test(id) && outputBytes > 500 * 1024,
        );
        if (legacySharedLocaleModules.length) {
          this.error(`Large shared locale chunk detected in ${output.fileName}; locale files must remain self-contained.`);
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [localeManifestPlugin(), react()],
  server: {
    host: "127.0.0.1",
    fs: {
      allow: [searchForWorkspaceRoot(workspaceRoot), dependencyRoot],
    },
    proxy: {
      "/api": "http://127.0.0.1:3000",
    },
  },
});
