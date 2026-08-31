import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const contractPath = resolve(repositoryRoot, "packages/contracts/openapi.yaml");
export const generatedPath = resolve(repositoryRoot, "apps/api/src/generated/openapi-request-guards.ts");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const JSON_MEDIA_TYPE = "application/json";
const POSITIVE_BIGINT_PATTERN = "^[1-9][0-9]*$";
const ANNOTATION_KEYS = new Set(["description", "example", "examples", "title", "deprecated", "readOnly", "writeOnly"]);

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function referenceName(reference, section) {
  const expression = new RegExp(`^#/components/${section}/([A-Za-z][A-Za-z0-9]*)$`, "u");
  const match = expression.exec(reference);
  if (!match) throw new Error(`Unsupported OpenAPI ${section} reference: ${reference}`);
  return match[1];
}

function schemaReferenceName(reference) {
  return referenceName(reference, "schemas");
}

function lowerFirst(value) {
  return value[0].toLowerCase() + value.slice(1);
}

function upperFirst(value) {
  return value[0].toUpperCase() + value.slice(1);
}

function literal(value) {
  return `z.literal(${JSON.stringify(value)})`;
}

function union(expressions) {
  if (expressions.length === 0) return "z.never()";
  if (expressions.length === 1) return expressions[0];
  return `z.union([${expressions.join(", ")}])`;
}

function intersection(expressions) {
  if (expressions.length === 0) return "z.unknown()";
  if (expressions.length === 1) return expressions[0];
  const combined = expressions.slice(1).reduce((left, right) => `z.intersection(${left}, ${right})`, expressions[0]);
  // Preserve JSON Schema allOf semantics on the original transport value. Object
  // intersection can merge unknown-key policies, weakening a strict constituent.
  // Preflight before the pipe also avoids validating transformed BIGINTs as strings.
  return `z.unknown().refine((value) => [${expressions.join(", ")}].every((candidate) => candidate.safeParse(value).success), { message: "Expected every intersected schema to match" }).pipe(${combined})`;
}

function componentVariable(name, mode) {
  return `${lowerFirst(name)}${mode === "request" ? "Request" : "Response"}ComponentSchema`;
}

function hasRuntimeKeyword(schema) {
  return Object.keys(schema).some((key) => key !== "$ref" && !ANNOTATION_KEYS.has(key));
}

function stringExpression(schema, mode) {
  let expression = "z.string()";
  if (schema["x-trim"] === true) expression += ".trim()";
  else if (schema["x-trim"] !== undefined && schema["x-trim"] !== false) {
    throw new Error(`x-trim must be boolean, received ${JSON.stringify(schema["x-trim"])}`);
  }
  if (schema.format === "email") expression += ".email()";
  else if (schema.format === "date") expression += ".date()";
  else if (schema.format === "date-time") expression += ".datetime({ offset: true })";
  else if (schema.format === "uuid") expression += ".uuid()";
  else if (schema.format === "binary" || schema.format === undefined) {
    // Binary appears only on non-JSON responses; treating it as a string keeps the converter total.
  } else throw new Error(`Unsupported OpenAPI string format: ${JSON.stringify(schema.format)}`);
  if (Number.isInteger(schema.minLength)) expression += `.min(${schema.minLength})`;
  if (Number.isInteger(schema.maxLength)) expression += `.max(${schema.maxLength})`;
  if (typeof schema.pattern === "string") expression += `.regex(new RegExp(${JSON.stringify(schema.pattern)}, "u"))`;
  if (mode === "request" && schema.pattern === POSITIVE_BIGINT_PATTERN) expression += ".transform((value) => BigInt(value))";
  return expression;
}

function baseExpression(schema, context) {
  if (Object.hasOwn(schema, "const")) return literal(schema.const);
  if (Array.isArray(schema.enum)) return union(schema.enum.map(literal));
  if (Array.isArray(schema.type)) return union(schema.type.map((type) => baseExpression({ ...schema, type }, context)));
  const type = schema.type ?? (schema.properties || schema.required || schema.additionalProperties !== undefined ? "object" : undefined);
  if (type === "string") return stringExpression(schema, context.mode);
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
    let expression = `z.array(${zodExpression(schema.items ?? true, context)})`;
    if (Number.isInteger(schema.minItems)) expression += `.min(${schema.minItems})`;
    if (Number.isInteger(schema.maxItems)) expression += `.max(${schema.maxItems})`;
    if (schema.uniqueItems === true) expression += '.refine((value) => new Set(value.map(uniqueItemKey)).size === value.length, { message: "Expected unique items" })';
    return expression;
  }
  if (type === "object") {
    const properties = schema.properties ? assertObject(schema.properties, "schema.properties") : {};
    const required = new Set(Array.isArray(schema.required) ? schema.required : []);
    const forbidden = [];
    const fields = [];
    for (const [name, rawProperty] of Object.entries(properties)) {
      const property = rawProperty === true || rawProperty === false ? rawProperty : assertObject(rawProperty, `property ${name}`);
      const excluded = property !== true && property !== false && ((context.mode === "request" && property.readOnly === true) || (context.mode === "response" && property.writeOnly === true));
      if (excluded) {
        forbidden.push(name);
        continue;
      }
      let expression = zodExpression(property, context);
      const hasDefault = property !== true && property !== false && Object.hasOwn(property, "default");
      if (required.has(name) && expression === "z.unknown()") expression += '.refine((value) => value !== undefined, { message: "Required" })';
      if (!required.has(name) && !hasDefault) expression += ".optional()";
      fields.push(`  ${JSON.stringify(name)}: ${expression},`);
    }
    for (const name of required) {
      if (!Object.hasOwn(properties, name)) fields.push(`  ${JSON.stringify(name)}: z.unknown().refine((value) => value !== undefined, { message: "Required" }),`);
    }
    let expression = `z.object({\n${fields.join("\n")}\n})`;
    if (schema.additionalProperties === false) expression += ".strict()";
    else if (schema.additionalProperties && typeof schema.additionalProperties === "object") expression += `.catchall(${zodExpression(schema.additionalProperties, context)})`;
    else expression += ".passthrough()";
    if (forbidden.length > 0) expression += `.refine((value) => ${JSON.stringify(forbidden)}.every((key) => !Object.hasOwn(value, key)), { message: ${JSON.stringify(`Forbidden ${context.mode} properties: ${forbidden.join(", ")}`)} })`;
    if (Number.isInteger(schema.minProperties)) expression += `.refine((value) => Object.keys(value).length >= ${schema.minProperties}, { message: "Expected at least ${schema.minProperties} properties" })`;
    if (Number.isInteger(schema.maxProperties)) expression += `.refine((value) => Object.keys(value).length <= ${schema.maxProperties}, { message: "Expected at most ${schema.maxProperties} properties" })`;
    return expression;
  }
  if (type === undefined) return "z.unknown()";
  throw new Error(`Unsupported OpenAPI schema type: ${JSON.stringify(type)}`);
}

function zodExpression(input, context) {
  if (input === true) return "z.unknown()";
  if (input === false) return "z.never()";
  const schema = assertObject(input, "OpenAPI schema");
  if (typeof schema.$ref === "string" && !hasRuntimeKeyword(schema)) return componentVariable(schemaReferenceName(schema.$ref), context.mode);
  const expressions = [];
  if (typeof schema.$ref === "string") expressions.push(componentVariable(schemaReferenceName(schema.$ref), context.mode));
  const baseKeywords = { ...schema };
  delete baseKeywords.$ref;
  delete baseKeywords.allOf;
  delete baseKeywords.oneOf;
  delete baseKeywords.anyOf;
  delete baseKeywords.not;
  if (Object.keys(baseKeywords).some((key) => !ANNOTATION_KEYS.has(key))) expressions.push(baseExpression(baseKeywords, context));
  if (Array.isArray(schema.allOf)) expressions.push(...schema.allOf.map((item) => zodExpression(item, context)));
  let expression = intersection(expressions);
  for (const keyword of ["oneOf", "anyOf"]) {
    if (!Array.isArray(schema[keyword])) continue;
    const branches = schema[keyword].map((item) => zodExpression(item, context));
    const matches = `[${branches.join(", ")}].filter((candidate) => candidate.safeParse(value).success).length`;
    if (expressions.length === 0) expression = union(branches);
    else if (keyword === "oneOf") expression += `.refine((value) => ${matches} === 1, { message: "Expected exactly one matching schema" })`;
    else expression += `.refine((value) => ${matches} >= 1, { message: "Expected at least one matching schema" })`;
  }
  if (schema.not !== undefined) {
    const excluded = zodExpression(schema.not, context);
    expression += `.refine((value) => !${excluded}.safeParse(value).success, { message: "Value matches excluded schema" })`;
  }
  if (Object.hasOwn(schema, "default")) expression += `.default(${JSON.stringify(schema.default)})`;
  return expression;
}

function collectSchemaComponents(input, components, ordered, visited, stack = []) {
  if (!input || typeof input !== "object") return;
  if (typeof input.$ref === "string") {
    const name = schemaReferenceName(input.$ref);
    if (stack.includes(name)) throw new Error(`Recursive OpenAPI schema is not supported: ${[...stack, name].join(" -> ")}`);
    if (!visited.has(name)) {
      const component = components[name];
      if (!component) throw new Error(`Missing OpenAPI component schema: ${name}`);
      collectSchemaComponents(component, components, ordered, visited, [...stack, name]);
      visited.add(name);
      ordered.push(name);
    }
  }
  for (const keyword of ["allOf", "oneOf", "anyOf", "prefixItems"]) for (const item of input[keyword] ?? []) collectSchemaComponents(item, components, ordered, visited, stack);
  collectSchemaComponents(input.items, components, ordered, visited, stack);
  collectSchemaComponents(input.additionalProperties, components, ordered, visited, stack);
  collectSchemaComponents(input.not, components, ordered, visited, stack);
  for (const property of Object.values(input.properties ?? {})) collectSchemaComponents(property, components, ordered, visited, stack);
}

function operations(document) {
  const paths = assertObject(document.paths, "OpenAPI paths");
  const result = [];
  const identifiers = new Set();
  for (const [path, pathItem] of Object.entries(paths)) {
    if (!pathItem || typeof pathItem !== "object" || Array.isArray(pathItem)) continue;
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== "object" || Array.isArray(operation)) continue;
      if (typeof operation.operationId !== "string") throw new Error(`Missing operationId for ${method.toUpperCase()} ${path}`);
      if (!/^[A-Za-z][A-Za-z0-9]*$/u.test(operation.operationId)) throw new Error(`operationId is not a TypeScript identifier: ${operation.operationId}`);
      if (identifiers.has(operation.operationId)) throw new Error(`Duplicate OpenAPI operationId: ${operation.operationId}`);
      identifiers.add(operation.operationId);
      result.push({ method, path, operationId: operation.operationId, operation });
    }
  }
  return result;
}

function resolveRequestBody(requestBody, document, label, stack = []) {
  const value = assertObject(requestBody, label);
  if (typeof value.$ref !== "string") return value;
  const name = referenceName(value.$ref, "requestBodies");
  if (stack.includes(name)) throw new Error(`Recursive requestBody reference: ${[...stack, name].join(" -> ")}`);
  const component = assertObject(document.components?.requestBodies?.[name], `components.requestBodies.${name}`);
  return resolveRequestBody(component, document, label, [...stack, name]);
}

function resolveResponse(response, document, label, stack = []) {
  const value = assertObject(response, label);
  if (typeof value.$ref !== "string") return value;
  const name = referenceName(value.$ref, "responses");
  if (stack.includes(name)) throw new Error(`Recursive response reference: ${[...stack, name].join(" -> ")}`);
  const component = assertObject(document.components?.responses?.[name], `components.responses.${name}`);
  return resolveResponse(component, document, label, [...stack, name]);
}

function bodySchema(content, label) {
  const mediaTypes = assertObject(content, `${label}.content`);
  const mediaType = mediaTypes[JSON_MEDIA_TYPE];
  if (!mediaType) return undefined;
  return assertObject(assertObject(mediaType, `${label}.${JSON_MEDIA_TYPE}`).schema, `${label}.${JSON_MEDIA_TYPE}.schema`);
}

function contractInventory(document) {
  const operationList = operations(document);
  const requests = [];
  const responses = [];
  for (const item of operationList) {
    if (item.operation.requestBody) {
      const requestBody = resolveRequestBody(item.operation.requestBody, document, `${item.operationId}.requestBody`);
      const schema = bodySchema(requestBody.content, `${item.operationId}.requestBody`);
      if (schema) requests.push({ ...item, schema, required: requestBody.required === true });
    }
    const responseMap = assertObject(item.operation.responses, `${item.operationId}.responses`);
    for (const [status, rawResponse] of Object.entries(responseMap)) {
      const response = resolveResponse(rawResponse, document, `${item.operationId}.responses.${status}`);
      if (!response.content) continue;
      const schema = bodySchema(response.content, `${item.operationId}.responses.${status}`);
      if (schema) responses.push({ ...item, status, schema });
    }
  }
  return { operationList, requests, responses };
}

function componentDeclarations(roots, components, mode) {
  const ordered = [];
  const visited = new Set();
  for (const root of roots) collectSchemaComponents(root, components, ordered, visited);
  return ordered.map((name) => {
    const expression = zodExpression(components[name], { mode });
    const variable = componentVariable(name, mode);
    return `export const ${variable} = ${expression};\nexport type ${upperFirst(variable.replace(/Schema$/u, ""))} = z.output<typeof ${variable}>;`;
  });
}

function requestDeclarations(requests) {
  const mapEntries = requests.map(({ operationId, schema, required }) => {
    let expression = zodExpression(schema, { mode: "request" });
    if (!required) expression += ".optional()";
    expression += ".transform(compactRequestBody)";
    return `  ${JSON.stringify(operationId)}: ${expression},`;
  });
  const aliases = requests.map(({ operationId }) => {
    const typeName = `${upperFirst(operationId)}Request`;
    return `export const ${operationId}RequestSchema = openApiRequestBodySchemas.${operationId};\nexport type ${typeName} = z.output<typeof ${operationId}RequestSchema>;\nexport type ${typeName}Transport = z.input<typeof ${operationId}RequestSchema>;`;
  });
  return { mapEntries, aliases };
}

function responseDeclarations(responses) {
  const grouped = new Map();
  for (const item of responses) {
    const entries = grouped.get(item.operationId) ?? [];
    entries.push(item);
    grouped.set(item.operationId, entries);
  }
  const mapEntries = [...grouped].map(([operationId, entries]) => {
    const statuses = entries.map(({ status, schema }) => `    ${JSON.stringify(status)}: ${zodExpression(schema, { mode: "response" })},`);
    return `  ${JSON.stringify(operationId)}: {\n${statuses.join("\n")}\n  },`;
  });
  const aliases = responses.map(({ operationId, status }) => {
    const safeStatus = status.replace(/[^A-Za-z0-9]/gu, "");
    const variable = `${operationId}${upperFirst(safeStatus)}ResponseSchema`;
    return `export const ${variable} = openApiResponseBodySchemas.${operationId}[${JSON.stringify(status)}];\nexport type ${upperFirst(variable.replace(/Schema$/u, ""))} = z.output<typeof ${variable}>;`;
  });
  return { mapEntries, aliases };
}

export function buildGeneratedSource(source = readFileSync(contractPath, "utf8")) {
  const canonicalSource = source.replace(/\r\n?/gu, "\n");
  const document = assertObject(parse(canonicalSource), "OpenAPI document");
  if (document.openapi !== "3.1.0") throw new Error(`Expected OpenAPI 3.1.0, received ${JSON.stringify(document.openapi)}`);
  const components = assertObject(assertObject(document.components, "OpenAPI components").schemas, "OpenAPI component schemas");
  const inventory = contractInventory(document);
  const requestParts = requestDeclarations(inventory.requests);
  const responseParts = responseDeclarations(inventory.responses);
  const requestComponents = componentDeclarations(inventory.requests.map((item) => item.schema), components, "request");
  const responseComponents = componentDeclarations(inventory.responses.map((item) => item.schema), components, "response");
  const hash = createHash("sha256").update(canonicalSource).digest("hex");
  const routeEntries = inventory.operationList.map(({ method, path, operationId }) => `  ${JSON.stringify(`${method.toUpperCase()} ${path}`)}: ${JSON.stringify(operationId)},`);
  const operationIds = inventory.operationList.map((item) => item.operationId);
  const requestOperationIds = inventory.requests.map((item) => item.operationId);
  const responseOperationIds = [...new Set(inventory.responses.map((item) => item.operationId))];
  return [
    "// This file is generated by scripts/generate-openapi-guards.mjs. Do not edit manually.",
    `// Contract SHA-256: ${hash}`,
    'import { z } from "zod";',
    "",
    `export const openApiContractSha256 = ${JSON.stringify(hash)};`,
    `export const openApiOperationIds = ${JSON.stringify(operationIds)} as const;`,
    `export const guardedOpenApiOperations = ${JSON.stringify(requestOperationIds)} as const;`,
    `export const openApiJsonResponseOperations = ${JSON.stringify(responseOperationIds)} as const;`,
    `export const openApiContractCoverage = { operations: ${operationIds.length}, requestBodies: ${requestOperationIds.length}, responseBodies: ${inventory.responses.length} } as const;`,
    "",
    "const uniqueItemKey = (value: unknown) => typeof value === \"bigint\" ? `bigint:${value.toString()}` : JSON.stringify(value);",
    "type OptionalKeys<Value extends object> = { [Key in keyof Value]-?: undefined extends Value[Key] ? Key : never }[keyof Value];",
    "type DeepExactOptional<Value> = Value extends readonly (infer Item)[] ? DeepExactOptional<Item>[] : Value extends object ? { [Key in Exclude<keyof Value, OptionalKeys<Value>>]: DeepExactOptional<Value[Key]> } & { [Key in OptionalKeys<Value>]?: DeepExactOptional<Exclude<Value[Key], undefined>> } : Value;",
    "const compactRequestBody = <Value>(value: Value): DeepExactOptional<Value> => {",
    "  if (Array.isArray(value)) return value.map((item) => compactRequestBody(item)) as DeepExactOptional<Value>;",
    "  if (value !== null && typeof value === \"object\") {",
    "    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined).map(([key, item]) => [key, compactRequestBody(item)])) as DeepExactOptional<Value>;",
    "  }",
    "  return value as DeepExactOptional<Value>;",
    "};",
    "",
    ...requestComponents.flatMap((declaration) => [declaration, ""]),
    ...responseComponents.flatMap((declaration) => [declaration, ""]),
    "export const openApiOperationRoutes = {",
    ...routeEntries,
    "} as const;",
    "",
    "export const openApiRequestBodySchemas = {",
    ...requestParts.mapEntries,
    "} as const;",
    "",
    "export const openApiResponseBodySchemas = {",
    ...responseParts.mapEntries,
    "} as const;",
    "",
    "export type OpenApiRequestOperationId = keyof typeof openApiRequestBodySchemas;",
    "export type OpenApiRequestBody<OperationId extends OpenApiRequestOperationId> = z.output<(typeof openApiRequestBodySchemas)[OperationId]>;",
    "export type OpenApiRequestTransport<OperationId extends OpenApiRequestOperationId> = z.input<(typeof openApiRequestBodySchemas)[OperationId]>;",
    "export function parseOpenApiRequestBody<OperationId extends OpenApiRequestOperationId>(operationId: OperationId, value: unknown): OpenApiRequestBody<OperationId> {",
    "  return openApiRequestBodySchemas[operationId].parse(value) as OpenApiRequestBody<OperationId>;",
    "}",
    "",
    "export type OpenApiJsonResponseOperationId = keyof typeof openApiResponseBodySchemas;",
    "export function parseOpenApiResponseBody(operationId: OpenApiJsonResponseOperationId, status: number | string, value: unknown): unknown {",
    "  const schemas = openApiResponseBodySchemas[operationId] as Record<string, z.ZodTypeAny>;",
    "  const schema = schemas[String(status)] ?? schemas.default;",
    "  if (!schema) throw new Error(`No JSON response schema for ${operationId} status ${status}`);",
    "  return schema.parse(value);",
    "}",
    "",
    ...requestParts.aliases.flatMap((declaration) => [declaration, ""]),
    ...responseParts.aliases.flatMap((declaration) => [declaration, ""]),
  ].join("\n");
}

const currentDocument = assertObject(parse(readFileSync(contractPath, "utf8")), "OpenAPI document");
const currentInventory = contractInventory(currentDocument);
export const guardedOperationIds = currentInventory.requests.map((item) => item.operationId);
export const responseOperationIds = [...new Set(currentInventory.responses.map((item) => item.operationId))];
const normalizeNewlines = (value) => value.replace(/\r\n?/gu, "\n");

function run() {
  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== "--check");
  if (unknownArguments.length) throw new Error(`Unknown arguments: ${unknownArguments.join(", ")}`);
  const generated = buildGeneratedSource();
  if (process.argv.includes("--check")) {
    const current = existsSync(generatedPath) ? readFileSync(generatedPath, "utf8") : undefined;
    if (current === undefined || normalizeNewlines(current) !== normalizeNewlines(generated)) {
      console.error("Generated OpenAPI guards are stale. Run: npm run contracts:generate");
      process.exitCode = 1;
      return;
    }
    console.log(`Generated OpenAPI contracts are current (${guardedOperationIds.length} request bodies, ${currentInventory.responses.length} response bodies).`);
    return;
  }
  mkdirSync(dirname(generatedPath), { recursive: true });
  writeFileSync(generatedPath, generated, "utf8");
  console.log(`Generated ${generatedPath} from ${guardedOperationIds.length} request bodies and ${currentInventory.responses.length} response bodies.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) run();
