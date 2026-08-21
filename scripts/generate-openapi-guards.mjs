import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const contractPath = resolve(repositoryRoot, "packages/contracts/openapi.yaml");
export const generatedPath = resolve(repositoryRoot, "apps/api/src/generated/openapi-request-guards.ts");
export const guardedOperationIds = [
  "login",
  "startSelfRegistration",
  "resendSelfRegistrationVerification",
  "verifySelfRegistration",
  "selectCompanyContext",
  "updateCurrentCompany",
  "replaceCompanySettings",
  "createCompanyCurrency",
  "replaceCompanyCurrencies",
  "upsertCompanyExchangeRate",
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function componentName(reference) {
  const match = /^#\/components\/schemas\/([A-Za-z][A-Za-z0-9]*)$/u.exec(reference);
  if (!match) throw new Error(`Unsupported request schema reference: ${reference}`);
  return match[1];
}

function lowerFirst(value) {
  return value[0].toLowerCase() + value.slice(1);
}

function literal(value) {
  return `z.literal(${JSON.stringify(value)})`;
}

function union(expressions) {
  if (expressions.length === 0) return "z.never()";
  if (expressions.length === 1) return expressions[0];
  return `z.union([${expressions.join(", ")}])`;
}

function zodExpression(input, components, referenceStack = []) {
  if (input === true) return "z.unknown()";
  if (input === false) return "z.never()";
  const schema = assertObject(input, "OpenAPI schema");

  if (typeof schema.$ref === "string") {
    const name = componentName(schema.$ref);
    if (referenceStack.includes(name)) throw new Error(`Recursive request schema is not supported yet: ${[...referenceStack, name].join(" -> ")}`);
    const referenced = components[name];
    if (!referenced) throw new Error(`Missing OpenAPI component schema: ${name}`);
    return zodExpression(referenced, components, [...referenceStack, name]);
  }
  if (Object.hasOwn(schema, "const")) return literal(schema.const);
  if (Array.isArray(schema.enum)) return union(schema.enum.map(literal));
  if (Array.isArray(schema.oneOf)) return union(schema.oneOf.map((item) => zodExpression(item, components, referenceStack)));
  if (Array.isArray(schema.anyOf)) return union(schema.anyOf.map((item) => zodExpression(item, components, referenceStack)));
  if (Array.isArray(schema.allOf)) {
    const expressions = schema.allOf.map((item) => zodExpression(item, components, referenceStack));
    if (expressions.length === 0) return "z.unknown()";
    return expressions.slice(1).reduce((left, right) => `z.intersection(${left}, ${right})`, expressions[0]);
  }
  if (Array.isArray(schema.type)) {
    return union(schema.type.map((type) => zodExpression({ ...schema, type }, components, referenceStack)));
  }

  const type = schema.type ?? (schema.properties ? "object" : undefined);
  if (type === "string") {
    let expression = "z.string()";
    if (schema["x-trim"] === true) expression += ".trim()";
    else if (schema["x-trim"] !== undefined && schema["x-trim"] !== false) throw new Error(`x-trim must be boolean, received ${JSON.stringify(schema["x-trim"])}`);
    if (schema.format === "email") expression += ".email()";
    else if (schema.format === "date") expression += ".date()";
    else if (schema.format === "date-time") expression += ".datetime({ offset: true })";
    else if (schema.format === "uuid") expression += ".uuid()";
    else if (schema.format !== undefined) throw new Error(`Unsupported OpenAPI string format: ${JSON.stringify(schema.format)}`);
    if (Number.isInteger(schema.minLength)) expression += `.min(${schema.minLength})`;
    if (Number.isInteger(schema.maxLength)) expression += `.max(${schema.maxLength})`;
    if (typeof schema.pattern === "string") expression += `.regex(new RegExp(${JSON.stringify(schema.pattern)}, "u"))`;
    return expression;
  }
  if (type === "integer" || type === "number") {
    let expression = type === "integer" ? "z.number().int()" : "z.number()";
    if (typeof schema.minimum === "number") expression += `.min(${schema.minimum})`;
    if (typeof schema.maximum === "number") expression += `.max(${schema.maximum})`;
    if (typeof schema.exclusiveMinimum === "number") expression += `.gt(${schema.exclusiveMinimum})`;
    if (typeof schema.exclusiveMaximum === "number") expression += `.lt(${schema.exclusiveMaximum})`;
    if (typeof schema.multipleOf === "number") expression += `.multipleOf(${schema.multipleOf})`;
    return expression;
  }
  if (type === "boolean") return "z.boolean()";
  if (type === "null") return "z.null()";
  if (type === "array") {
    let expression = `z.array(${zodExpression(schema.items ?? true, components, referenceStack)})`;
    if (Number.isInteger(schema.minItems)) expression += `.min(${schema.minItems})`;
    if (Number.isInteger(schema.maxItems)) expression += `.max(${schema.maxItems})`;
    if (schema.uniqueItems === true) expression += '.refine((value) => new Set(value.map((item) => JSON.stringify(item))).size === value.length, { message: "Expected unique items" })';
    return expression;
  }
  if (type === "object") {
    const properties = schema.properties ? assertObject(schema.properties, "schema.properties") : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const fields = Object.entries(properties).map(([name, property]) => {
      const expression = zodExpression(property, components, referenceStack) + (required.has(name) ? "" : ".optional()");
      return `  ${JSON.stringify(name)}: ${expression},`;
    });
    let expression = `z.object({\n${fields.join("\n")}\n})`;
    if (schema.additionalProperties === false) expression += ".strict()";
    else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      expression += `.catchall(${zodExpression(schema.additionalProperties, components, referenceStack)})`;
    } else expression += ".passthrough()";
    if (Number.isInteger(schema.minProperties)) {
      expression += `.refine((value) => Object.keys(value).length >= ${schema.minProperties}, { message: "Expected at least ${schema.minProperties} properties" })`;
    }
    if (Number.isInteger(schema.maxProperties)) {
      expression += `.refine((value) => Object.keys(value).length <= ${schema.maxProperties}, { message: "Expected at most ${schema.maxProperties} properties" })`;
    }
    return expression;
  }
  if (type === undefined) return "z.unknown()";
  throw new Error(`Unsupported OpenAPI schema type: ${JSON.stringify(type)}`);
}

function requestSchemas(document) {
  const paths = assertObject(document.paths, "OpenAPI paths");
  const components = assertObject(assertObject(document.components, "OpenAPI components").schemas, "OpenAPI component schemas");
  const operations = new Map();
  for (const pathItem of Object.values(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of ["get", "post", "put", "patch", "delete"]) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation) || typeof operation.operationId !== "string") continue;
      if (operations.has(operation.operationId)) throw new Error(`Duplicate OpenAPI operationId: ${operation.operationId}`);
      operations.set(operation.operationId, operation);
    }
  }

  return guardedOperationIds.map((operationId) => {
    const operation = operations.get(operationId);
    if (!operation) throw new Error(`Missing guarded OpenAPI operation: ${operationId}`);
    const requestBody = assertObject(operation.requestBody, `${operationId}.requestBody`);
    const content = assertObject(requestBody.content, `${operationId}.requestBody.content`);
    const mediaType = assertObject(content["application/json"], `${operationId} application/json request body`);
    const schema = assertObject(mediaType.schema, `${operationId} request schema`);
    if (typeof schema.$ref !== "string") throw new Error(`${operationId} request body must reference a component schema`);
    const name = componentName(schema.$ref);
    const component = components[name];
    if (!component) throw new Error(`Missing guarded component schema: ${name}`);
    return { operationId, name, expression: zodExpression(component, components, [name]) };
  });
}

export function buildGeneratedSource(source = readFileSync(contractPath, "utf8")) {
  const document = assertObject(parse(source), "OpenAPI document");
  if (document.openapi !== "3.1.0") throw new Error(`Expected OpenAPI 3.1.0, received ${JSON.stringify(document.openapi)}`);
  const schemas = requestSchemas(document);
  const hash = createHash("sha256").update(source).digest("hex");
  const declarations = schemas.map(({ name, expression }) => {
    const variable = `${lowerFirst(name)}Schema`;
    return `export const ${variable} = ${expression};\nexport type ${name} = z.infer<typeof ${variable}>;`;
  });
  return [
    "// This file is generated by scripts/generate-openapi-guards.mjs. Do not edit manually.",
    `// Contract SHA-256: ${hash}`,
    "import { z } from \"zod\";",
    "",
    `export const guardedOpenApiOperations = ${JSON.stringify(guardedOperationIds)} as const;`,
    "",
    ...declarations.flatMap((declaration) => [declaration, ""]),
  ].join("\n");
}

function run() {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unknownArguments.length) throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
  const generated = buildGeneratedSource();
  if (process.argv.includes("--check")) {
    const current = existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : undefined;
    if (current !== generated) {
      console.error("Generated OpenAPI guards are stale. Run: npm run contracts:generate");
      process.exitCode = 1;
      return;
    }
    console.log(`Generated OpenAPI guards are current (${guardedOperationIds.length} operations).`);
    return;
  }
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, generated, "utf8");
  console.log(`Generated ${generatedPath} from ${guardedOperationIds.length} OpenAPI operations.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
