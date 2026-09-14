#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const requiredEntryFields = ['id', 'owner', 'removalSlice', 'rationale', 'paths', 'matcher', 'baseline', 'expiry'];

export function normalizeRepositoryPath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

function fail(message) {
  throw new Error(`Architecture debt ratchet: ${message}`);
}

function requiredString(entry, field) {
  if (typeof entry[field] !== 'string' || entry[field].trim() === '') fail(`${entry.id ?? '<unknown>'}: missing ${field}`);
}

function assertExactRepositoryPath(entry, value, label) {
  if (typeof value !== 'string' || value.trim() === '' || path.isAbsolute(value) || value.includes('..') || /[*?{}]/.test(value)) {
    fail(`${entry.id}: ${label} must be a non-glob repository-relative path`);
  }
}

function assertLiteralMatcher(entry, matcher, label = 'matcher') {
  if (!matcher || matcher.type !== 'literal' || typeof matcher.value !== 'string' || matcher.value.length === 0) {
    fail(`${entry.id}: ${label} must be a non-empty literal matcher`);
  }
}

function validateExpiry(entry) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiry) || Number.isNaN(Date.parse(`${entry.expiry}T00:00:00Z`))) {
    fail(`${entry.id}: expiry must be an ISO date`);
  }
}

export function validateRegister(register) {
  if (!register || register.schemaVersion !== 1 || !Array.isArray(register.entries) || register.entries.length === 0) {
    fail('register must have schemaVersion 1 and at least one entry');
  }
  const ids = new Set();
  for (const entry of register.entries) {
    for (const field of requiredEntryFields) if (!(field in entry)) fail(`${entry.id ?? '<unknown>'}: missing ${field}`);
    for (const field of ['id', 'owner', 'removalSlice', 'rationale']) requiredString(entry, field);
    if (ids.has(entry.id)) fail(`${entry.id}: duplicate entry id`);
    ids.add(entry.id);
    if (!Array.isArray(entry.paths) || entry.paths.length === 0) fail(`${entry.id}: paths must not be empty`);
    entry.paths.forEach((value) => assertExactRepositoryPath(entry, value, 'path'));
    assertLiteralMatcher(entry, entry.matcher);
    if (!Number.isInteger(entry.baseline.occurrences) || entry.baseline.occurrences < 0) fail(`${entry.id}: baseline.occurrences must be a non-negative integer`);
    if (!Array.isArray(entry.baseline.locations) || entry.baseline.locations.length !== entry.baseline.occurrences) {
      fail(`${entry.id}: baseline.locations must contain every baseline occurrence`);
    }
    for (const location of entry.baseline.locations) {
      assertExactRepositoryPath(entry, location.path, 'baseline location path');
      if (!entry.paths.map(normalizeRepositoryPath).includes(normalizeRepositoryPath(location.path))) {
        fail(`${entry.id}: baseline location must be in paths`);
      }
      if (!Number.isInteger(location.line) || location.line < 1 || !Number.isInteger(location.column) || location.column < 1) {
        fail(`${entry.id}: baseline locations require positive line and column`);
      }
    }
    validateExpiry(entry);
    if (!Array.isArray(entry.exceptions)) fail(`${entry.id}: exceptions must be an array`);
    for (const exception of entry.exceptions) {
      assertExactRepositoryPath(entry, exception.path, 'exception path');
      assertLiteralMatcher(entry, exception.matcher, 'exception matcher');
      if (typeof exception.rationale !== 'string' || exception.rationale.trim() === '') fail(`${entry.id}: exception requires rationale`);
    }
  }
}

function findLiteralLocations(text, literal, repositoryPath) {
  const locations = [];
  let start = 0;
  while (true) {
    const index = text.indexOf(literal, start);
    if (index === -1) break;
    const before = text.slice(0, index);
    locations.push({
      path: repositoryPath,
      line: before.split('\n').length,
      column: index - before.lastIndexOf('\n'),
    });
    start = index + literal.length;
  }
  return locations;
}

async function readLocations(root, paths, matcher) {
  const locations = [];
  for (const configuredPath of paths) {
    const repositoryPath = normalizeRepositoryPath(configuredPath);
    let text;
    try {
      text = await readFile(path.join(root, repositoryPath), 'utf8');
    } catch (error) {
      fail(`cannot read ${repositoryPath}: ${error.code ?? error.message}`);
    }
    locations.push(...findLiteralLocations(text, matcher.value, repositoryPath));
  }
  return locations;
}

function sameLocations(expected, actual) {
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export async function evaluateRegister({ root, register, now = new Date() }) {
  validateRegister(register);
  const results = [];
  for (const entry of register.entries) {
    if (new Date(`${entry.expiry}T23:59:59.999Z`) < now) fail(`${entry.id}: expired on ${entry.expiry}; remove the debt or renew it explicitly`);
    const locations = await readLocations(root, entry.paths, entry.matcher);
    const expectedLocations = entry.baseline.locations.map((location) => ({ ...location, path: normalizeRepositoryPath(location.path) }));
    if (locations.length > entry.baseline.occurrences) fail(`${entry.id}: occurrence count increased from ${entry.baseline.occurrences} to ${locations.length}`);
    if (locations.length < entry.baseline.occurrences) fail(`${entry.id}: occurrence count decreased from ${entry.baseline.occurrences} to ${locations.length}; lower the baseline in the register so removed debt cannot return`);
    if (!sameLocations(expectedLocations, locations)) fail(`${entry.id}: occurrence location changed; update the implementation/removal slice and baseline deliberately`);
    for (const exception of entry.exceptions) {
      const exceptionLocations = await readLocations(root, [exception.path], exception.matcher);
      if (exceptionLocations.length === 0) fail(`${entry.id}: semantic exception is missing at ${normalizeRepositoryPath(exception.path)}`);
    }
    results.push({ id: entry.id, occurrences: locations.length, expiry: entry.expiry });
  }
  return results;
}

async function main() {
  const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf('--root');
  const root = rootFlag === -1 ? path.resolve(scriptDirectory, '..') : path.resolve(args[rootFlag + 1] ?? '');
  const registerPath = path.join(root, 'scripts', 'architecture-debt-register.json');
  const register = JSON.parse(await readFile(registerPath, 'utf8'));
  const results = await evaluateRegister({ root, register });
  for (const result of results) console.log(`PASS ${result.id}: ${result.occurrences} occurrence(s), expires ${result.expiry}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
