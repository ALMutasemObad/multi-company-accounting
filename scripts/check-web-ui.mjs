import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { parse } from "@babel/parser";

const sourceDir = path.resolve("apps/web/src");
const failures = [];
let pageHeaders = 0;
let tableRegions = 0;

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [target] : [];
  }));
  return nested.flat();
}

function tagName(opening) {
  return opening.name.type === "JSXIdentifier" ? opening.name.name : "";
}

function attribute(opening, name) {
  return opening.attributes.find((item) => item.type === "JSXAttribute" && item.name.name === name);
}

function stringAttribute(opening, name) {
  const item = attribute(opening, name);
  if (!item?.value) return "";
  if (item.value.type === "StringLiteral") return item.value.value;
  if (item.value.type === "JSXExpressionContainer" && item.value.expression.type === "StringLiteral") {
    return item.value.expression.value;
  }
  return "";
}

function lineLabel(file, node) {
  return `${path.relative(process.cwd(), file)}:${node.loc?.start.line ?? 1}`;
}

function visit(file, node, ancestors = []) {
  if (!node || typeof node !== "object") return;

  if (node.type === "JSXElement") {
    const opening = node.openingElement;
    const tag = tagName(opening);
    const className = stringAttribute(opening, "className");
    const classes = new Set(className.split(/\s+/).filter(Boolean));
    const insideForm = ancestors.some((item) => item.type === "JSXElement" && tagName(item.openingElement) === "form");
    const insideLabel = ancestors.some((item) => item.type === "JSXElement" && tagName(item.openingElement) === "label");

    if ((tag === "button" || tag === "Button") && insideForm && !attribute(opening, "type")) {
      failures.push(`${lineLabel(file, opening)}: form buttons must declare type=\"button\" or type=\"submit\" explicitly`);
    }

    if (["input", "select", "textarea"].includes(tag)
      && stringAttribute(opening, "type") !== "hidden"
      && !insideLabel
      && !attribute(opening, "aria-label")
      && !attribute(opening, "aria-labelledby")) {
      failures.push(`${lineLabel(file, opening)}: form controls require an associated label or an accessible aria label`);
    }

    if (classes.has("page-heading") && path.basename(file) !== "ui.tsx") {
      failures.push(`${lineLabel(file, opening)}: use the shared PageHeader component`);
    }

    if (tag === "PageHeader") pageHeaders += 1;

    if (classes.has("data-table-wrap")) {
      tableRegions += 1;
      if (stringAttribute(opening, "role") !== "region" || !attribute(opening, "tabIndex") || !attribute(opening, "aria-label")) {
        failures.push(`${lineLabel(file, opening)}: scrollable tables require role=\"region\", tabIndex, and an aria-label`);
      }
    }

    if ((classes.has("error-panel") || classes.has("form-error")) && stringAttribute(opening, "role") !== "alert") {
      failures.push(`${lineLabel(file, opening)}: visible error messages require role=\"alert\"`);
    }
  }

  const nextAncestors = node.type === "JSXElement" ? [...ancestors, node] : ancestors;
  for (const [key, value] of Object.entries(node)) {
    if (key === "loc" || key === "start" || key === "end" || key === "extra") continue;
    if (Array.isArray(value)) {
      for (const child of value) visit(file, child, nextAncestors);
    } else if (value && typeof value === "object") {
      visit(file, value, nextAncestors);
    }
  }
}

for (const file of await sourceFiles(sourceDir)) {
  const source = await readFile(file, "utf8");
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: false,
    });
  } catch (error) {
    failures.push(`${path.relative(process.cwd(), file)}: could not parse: ${error.message}`);
    continue;
  }
  visit(file, ast);
}

const styles = await readFile(path.join(sourceDir, "styles.css"), "utf8");
const requiredCss = [
  [":focus-visible", "a visible keyboard-focus treatment"],
  ["prefers-reduced-motion", "a reduced-motion fallback"],
  ["--content-max", "a shared content-width token"],
  ["overflow-x: auto", "horizontal containment for wide data"],
];
for (const [token, description] of requiredCss) {
  if (!styles.includes(token)) failures.push(`apps/web/src/styles.css: missing ${description}`);
}
if (/\b(?:html|body)\s*\{[^}]*overflow-x\s*:\s*hidden/s.test(styles)) {
  failures.push("apps/web/src/styles.css: do not hide document-level horizontal overflow");
}
if (/\b100vw\b/.test(styles)) {
  failures.push("apps/web/src/styles.css: avoid 100vw because it can include the scrollbar width and overflow");
}
if (pageHeaders !== 16) failures.push(`Expected 16 shared PageHeader usages; found ${pageHeaders}`);
if (tableRegions !== 31) failures.push(`Expected 31 accessible table regions; found ${tableRegions}`);

if (failures.length) {
  console.error("Web UI contract check failed:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Web UI contract check passed (${pageHeaders} page headers, ${tableRegions} table regions).`);
