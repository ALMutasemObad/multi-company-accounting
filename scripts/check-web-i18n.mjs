import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";

const sourceRoot = path.resolve("apps/web/src");
const visibleAttributes = new Set(["aria-label", "alt", "description", "label", "placeholder", "title"]);
const nonTranslatableTerms = new Set(["CSV", "Excel", "IBAN", "PDF", "SA…"]);
const findings = [];

function hasVisibleCharacters(value) {
  const normalized = value.trim();
  const technicalValue = nonTranslatableTerms.has(normalized)
    || /^\d+(?:\.\d+)*$/u.test(normalized)
    || /^[A-Z]{2,5}$/u.test(normalized)
    || /^[A-Za-z_]+\/[A-Za-z_]+$/u.test(normalized);
  return !technicalValue && /[\p{L}\p{N}]/u.test(normalized);
}

function location(filename, node, message) {
  findings.push(`${path.relative(process.cwd(), filename)}:${node.loc?.start.line ?? 1}:${node.loc?.start.column ?? 0} ${message}`);
}

function inspectRenderedExpression(filename, node) {
  if (!node) return;
  if (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TypeCastExpression"].includes(node.type)) {
    inspectRenderedExpression(filename, node.expression);
    return;
  }
  if (node.type === "StringLiteral") {
    if (hasVisibleCharacters(node.value)) location(filename, node, `hard-coded rendered string: ${JSON.stringify(node.value)}`);
    return;
  }
  if (node.type === "TemplateLiteral") {
    for (const quasi of node.quasis) {
      if (hasVisibleCharacters(quasi.value.cooked ?? quasi.value.raw)) location(filename, quasi, `hard-coded rendered template text: ${JSON.stringify(quasi.value.cooked ?? quasi.value.raw)}`);
    }
    return;
  }
  if (node.type === "ConditionalExpression") {
    inspectRenderedExpression(filename, node.consequent);
    inspectRenderedExpression(filename, node.alternate);
    return;
  }
  if (node.type === "LogicalExpression") {
    inspectRenderedExpression(filename, node.right);
    return;
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    inspectRenderedExpression(filename, node.left);
    inspectRenderedExpression(filename, node.right);
    return;
  }
  if (node.type === "SequenceExpression") inspectRenderedExpression(filename, node.expressions.at(-1));
}

function walk(filename, node, parent = null, functionDepth = 0) {
  if (!node || typeof node !== "object") return;
  if (
    node.type === "CallExpression"
    && node.callee?.type === "Identifier"
    && ["t", "translate"].includes(node.callee.name)
    && functionDepth === 0
  ) {
    location(filename, node, "translation evaluated at module initialization instead of render/call time");
  }
  if (node.type === "JSXText" && hasVisibleCharacters(node.value)) {
    location(filename, node, `hard-coded JSX text: ${JSON.stringify(node.value.trim())}`);
  }
  if (node.type === "JSXAttribute" && node.value?.type === "StringLiteral") {
    const name = node.name?.name;
    if (visibleAttributes.has(name) && hasVisibleCharacters(node.value.value)) {
      location(filename, node.value, `hard-coded ${name} attribute: ${JSON.stringify(node.value.value)}`);
    }
  }
  if (node.type === "JSXExpressionContainer") {
    const attributeName = parent?.type === "JSXAttribute" ? parent.name?.name : null;
    if (parent?.type !== "JSXAttribute" || visibleAttributes.has(attributeName)) inspectRenderedExpression(filename, node.expression);
  }
  if (node.type === "StringLiteral" && /^(?:ar|en)-[A-Z]{2}$/u.test(node.value)) {
    location(filename, node, `hard-coded Intl locale: ${JSON.stringify(node.value)}`);
  }
  const childFunctionDepth = functionDepth + ([
    "ArrowFunctionExpression",
    "ClassMethod",
    "FunctionDeclaration",
    "FunctionExpression",
    "ObjectMethod",
  ].includes(node.type) ? 1 : 0);
  for (const [key, value] of Object.entries(node)) {
    if (["loc", "start", "end", "extra"].includes(key)) continue;
    if (Array.isArray(value)) value.forEach((child) => walk(filename, child, node, childFunctionDepth));
    else if (value && typeof value === "object" && typeof value.type === "string") walk(filename, value, node, childFunctionDepth);
  }
}

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return /\.tsx?$/u.test(entry.name) ? [fullPath] : [];
  });
}

function unwrapExpression(node) {
  let current = node;
  while (["TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression"].includes(current?.type)) current = current.expression;
  return current;
}

function exportedConstant(ast, name) {
  for (const statement of ast.program.body) {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration?.type !== "VariableDeclaration") continue;
    for (const declaration of statement.declaration.declarations) {
      if (declaration.id.type === "Identifier" && declaration.id.name === name) return unwrapExpression(declaration.init);
    }
  }
  return undefined;
}

function literalObject(filename, node, label) {
  if (node?.type !== "ObjectExpression") {
    findings.push(`${path.relative(process.cwd(), filename)} must export ${label} as a literal object`);
    return undefined;
  }
  const values = {};
  for (const property of node.properties) {
    if (property.type !== "ObjectProperty" || property.computed || property.value.type !== "StringLiteral") {
      location(filename, property, `${label} accepts literal string properties only`);
      continue;
    }
    const key = property.key.type === "StringLiteral" || property.key.type === "Identifier" ? property.key.name ?? property.key.value : undefined;
    if (!key) {
      location(filename, property, `${label} contains an invalid key`);
      continue;
    }
    if (Object.hasOwn(values, key)) location(filename, property, `${label} contains duplicate key ${key}`);
    values[key] = property.value.value;
  }
  return values;
}

function canonicalLocale(value) {
  try {
    return Intl.getCanonicalLocales(value)[0];
  } catch {
    return undefined;
  }
}

function interpolationPlaceholders(message) {
  return [...message.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/gu)].map((match) => match[1]).sort();
}

function inspectLocaleFiles() {
  const localeRoot = path.join(sourceRoot, "i18n", "locales");
  const localeFiles = fs.readdirSync(localeRoot)
    .filter((name) => name.endsWith(".locale.ts"))
    .sort()
    .map((name) => path.join(localeRoot, name));
  const definitions = [];
  for (const filename of localeFiles) {
    const source = fs.readFileSync(filename, "utf8");
    const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
    for (const statement of ast.program.body) {
      if (statement.type === "ImportDeclaration" && statement.importKind !== "type") {
        location(filename, statement, "locale files must be self-contained and may only use type-only imports");
      }
    }
    const metadata = literalObject(filename, exportedConstant(ast, "localeMetadata"), "localeMetadata");
    const dictionary = literalObject(filename, exportedConstant(ast, "localeDictionary"), "localeDictionary");
    if (!metadata || !dictionary) continue;
    const requiredMetadata = ["code", "nativeName", "dir", "intl"];
    const metadataKeys = Object.keys(metadata).sort();
    if (JSON.stringify(metadataKeys) !== JSON.stringify([...requiredMetadata].sort())) {
      findings.push(`${path.relative(process.cwd(), filename)} localeMetadata must contain exactly ${requiredMetadata.join(", ")}`);
    }
    if (!metadata.code || !metadata.nativeName?.trim() || !metadata.intl || !["rtl", "ltr"].includes(metadata.dir)) {
      findings.push(`${path.relative(process.cwd(), filename)} has missing or invalid locale metadata`);
    }
    const canonicalCode = canonicalLocale(metadata.code);
    const canonicalIntl = canonicalLocale(metadata.intl);
    if (!canonicalCode || canonicalCode !== metadata.code || !canonicalIntl || canonicalIntl !== metadata.intl) {
      findings.push(`${path.relative(process.cwd(), filename)} code and intl must be canonical BCP47 tags`);
    }
    if (path.basename(filename) !== `${metadata.code}.locale.ts`) {
      findings.push(`${path.relative(process.cwd(), filename)} filename must match localeMetadata.code`);
    }
    if (!Object.keys(dictionary).length) findings.push(`${path.relative(process.cwd(), filename)} localeDictionary must not be empty`);
    definitions.push({ filename, metadata, dictionary });
  }
  const arabic = definitions.find(({ metadata }) => metadata.code === "ar");
  if (!arabic) {
    findings.push("apps/web/src/i18n/locales/ar.locale.ts is required as the safe fallback and translation-key source");
    return definitions;
  }
  const seenCodes = new Set();
  for (const definition of definitions) {
    if (seenCodes.has(definition.metadata.code)) findings.push(`duplicate locale code ${definition.metadata.code}`);
    seenCodes.add(definition.metadata.code);
    const sourceKeys = Object.keys(arabic.dictionary).sort();
    const keys = Object.keys(definition.dictionary).sort();
    const missing = sourceKeys.filter((key) => !Object.hasOwn(definition.dictionary, key));
    const extra = keys.filter((key) => !Object.hasOwn(arabic.dictionary, key));
    if (missing.length || extra.length) {
      findings.push(`${path.relative(process.cwd(), definition.filename)} dictionary keys differ from Arabic (missing: ${missing.slice(0, 5).join(", ") || "none"}; extra: ${extra.slice(0, 5).join(", ") || "none"})`);
    }
    for (const key of sourceKeys) {
      const value = definition.dictionary[key];
      if (typeof value !== "string") continue;
      if (!value.trim()) findings.push(`${path.relative(process.cwd(), definition.filename)} ${key} must not be empty`);
      if (/TODO|__MCAP_/u.test(value)) findings.push(`${path.relative(process.cwd(), definition.filename)} ${key} contains a migration marker`);
      if (JSON.stringify(interpolationPlaceholders(value)) !== JSON.stringify(interpolationPlaceholders(arabic.dictionary[key]))) {
        findings.push(`${path.relative(process.cwd(), definition.filename)} ${key} interpolation placeholders differ from Arabic`);
      }
    }
  }
  for (const required of ["ar", "en", "ur", "hi"]) {
    if (!seenCodes.has(required)) findings.push(`existing locale ${required} must remain available`);
  }
  return definitions;
}

for (const fullPath of sourceFiles(sourceRoot).sort()) {
  const relativePath = path.relative(sourceRoot, fullPath).replaceAll("\\", "/");
  const isLocaleDictionary = relativePath.startsWith("i18n/locales/");
  const isTest = /(?:^|\/)[^/]+\.test\.tsx?$/u.test(relativePath);
  const source = fs.readFileSync(fullPath, "utf8");
  if (!isLocaleDictionary && !isTest && /\p{Script=Arabic}/u.test(source)) {
    findings.push(`${path.relative(process.cwd(), fullPath)} contains Arabic text outside a locale dictionary`);
  }
  if (isLocaleDictionary || isTest) continue;
  const ast = parse(source, { sourceType: "module", plugins: ["jsx", "typescript"] });
  walk(fullPath, ast);
}

const localeDefinitions = inspectLocaleFiles();
const registrySource = fs.readFileSync(path.join(sourceRoot, "i18n", "locales", "registry.ts"), "utf8");
if (!registrySource.includes('from "virtual:locale-manifest"') || /\.locale["']/u.test(registrySource)) {
  findings.push("apps/web/src/i18n/locales/registry.ts must consume the generated metadata manifest without importing locale modules");
}
const i18nCoreSource = fs.readFileSync(path.join(sourceRoot, "i18n", "core.ts"), "utf8");
if (!i18nCoreSource.includes('import.meta.glob<LocaleModule>("./locales/*.locale.ts")')) {
  findings.push("apps/web/src/i18n/core.ts must discover locale files through the lazy import.meta.glob convention");
}
const mainSource = fs.readFileSync(path.join(sourceRoot, "main.tsx"), "utf8");
if (!mainSource.includes('await loadLocale("ar")')) {
  findings.push("apps/web/src/main.tsx must load the Arabic fallback before rendering the application");
}

if (findings.length) {
  console.error("Web i18n gate failed:\n" + findings.map((finding) => `- ${finding}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Web i18n gate passed: ${localeDefinitions.length} self-contained locale files are complete, discoverable, and asynchronously split.`);
}
