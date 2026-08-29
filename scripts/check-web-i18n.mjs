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

const registrySource = fs.readFileSync(path.join(sourceRoot, "i18n", "locales", "registry.ts"), "utf8");
if (/from\s+["']\.\/(?:ar|en|ur|hi)["']/u.test(registrySource) || /messages\s*:/u.test(registrySource)) {
  findings.push("apps/web/src/i18n/locales/registry.ts must keep metadata only; locale dictionaries are loaded asynchronously");
}
const i18nCoreSource = fs.readFileSync(path.join(sourceRoot, "i18n", "core.ts"), "utf8");
for (const locale of ["ar", "en", "ur", "hi"]) {
  if (!i18nCoreSource.includes(`import("./locales/${locale}")`)) {
    findings.push(`apps/web/src/i18n/core.ts must dynamically import the ${locale} dictionary`);
  }
}
const mainSource = fs.readFileSync(path.join(sourceRoot, "main.tsx"), "utf8");
if (!mainSource.includes('await loadLocale("ar")')) {
  findings.push("apps/web/src/main.tsx must load the Arabic fallback before rendering the application");
}

if (findings.length) {
  console.error("Web i18n gate failed:\n" + findings.map((finding) => `- ${finding}`).join("\n"));
  process.exitCode = 1;
} else {
  console.log("Web i18n gate passed: translations stay runtime-safe and locale dictionaries remain asynchronously split.");
}
