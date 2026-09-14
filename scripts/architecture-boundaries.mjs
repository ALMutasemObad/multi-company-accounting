import { readFile, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptExtensions = /\.(?:[mc]?[jt]s|[jt]sx)$/u;
const moduleName = (value) => value.replace(scriptExtensions, '');
const slash = (value) => value.replaceAll('\\', '/');
const inside = (value) => value !== '..' && !value.startsWith('../') && !path.isAbsolute(value);

// A selector is an exact module or a subtree, never an unanchored name match.
export function matches(file, selector) {
  if (selector.endsWith('/**')) {
    const directory = selector.slice(0, -3);
    return file === directory || file.startsWith(`${directory}/`);
  }
  return moduleName(file) === moduleName(selector);
}

function validPath(value, selector = false) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':')) return false;
  const plain = selector && value.endsWith('/**') ? value.slice(0, -3) : value;
  return !plain.includes('*') && !plain.startsWith('/') &&
    plain.split('/').every((part) => part && part !== '.' && part !== '..');
}

export function validateManifest(manifest) {
  const fail = (message) => { throw new Error(`Invalid boundary manifest: ${message}`); };
  if (manifest?.schemaVersion !== 1) fail('schemaVersion must be 1');
  const paths = (values, name, selectors = true, allowEmpty = false) => {
    if (!Array.isArray(values) || (!allowEmpty && !values.length) || !values.every((v) => validPath(v, selectors))) fail(name);
  };
  paths(manifest.scanRoots, 'scanRoots', false);
  if (!Array.isArray(manifest.extensions) || !manifest.extensions.length ||
      !manifest.extensions.every((ext) => /^\.(?:[mc]?[jt]s)$/u.test(ext))) fail('extensions');
  if (!Array.isArray(manifest.ignoreDirectories) || !manifest.ignoreDirectories.every((v) => validPath(v) && !v.includes('/'))) fail('ignoreDirectories');
  if (!manifest.aliases || typeof manifest.aliases !== 'object' || Array.isArray(manifest.aliases)) fail('aliases');
  for (const [prefix, target] of Object.entries(manifest.aliases)) {
    if (!prefix.endsWith('/') || prefix.startsWith('.') || !validPath(prefix.slice(0, -1)) || !validPath(target)) fail('alias prefix/target');
  }
  if (!Array.isArray(manifest.contexts) || !manifest.contexts.length) fail('contexts');
  const ids = new Set();
  const owned = [];
  for (const context of manifest.contexts) {
    if (!context.id || ids.has(context.id)) fail('unique context id required');
    ids.add(context.id);
    paths(context.paths, `paths of ${context.id}`);
    for (const selector of context.paths) {
      const probe = selector.endsWith('/**') ? `${selector.slice(0, -3)}/__probe.ts` : selector;
      if (!manifest.scanRoots.some((root) => probe.startsWith(`${root}/`))) fail(`path outside scanRoots: ${selector}`);
      for (const previous of owned) {
        const oldProbe = previous.endsWith('/**') ? `${previous.slice(0, -3)}/__probe.ts` : previous;
        if (matches(probe, previous) || matches(oldProbe, selector)) fail(`overlapping ownership: ${previous}, ${selector}`);
      }
      owned.push(selector);
    }
  }
  paths(manifest.compositionRoots, 'compositionRoots', true, true);
  for (const selector of manifest.compositionRoots) {
    const probe = selector.endsWith('/**') ? `${selector.slice(0, -3)}/__probe.ts` : selector;
    if (owned.some((owner) => matches(probe, owner) || matches(owner.replace('/**', '/__probe.ts'), selector))) fail('composition overlaps a context');
  }
  if (!Array.isArray(manifest.integrations) || !Array.isArray(manifest.forbiddenImports) || !Array.isArray(manifest.forbiddenSpecifiers)) fail('rule arrays');
  const ruleIds = new Set();
  for (const rule of [...manifest.integrations, ...manifest.forbiddenImports, ...manifest.forbiddenSpecifiers]) {
    if (!rule.id || ruleIds.has(rule.id) || !rule.reason) fail('unique rule id and reason required');
    ruleIds.add(rule.id);
    if (rule.fromPaths) paths(rule.fromPaths, `fromPaths of ${rule.id}`);
    if (rule.fromContexts && (!Array.isArray(rule.fromContexts) || !rule.fromContexts.length || !rule.fromContexts.every((id) => ids.has(id)))) fail(`fromContexts of ${rule.id}`);
    if (!rule.fromPaths && !rule.fromContexts) fail(`source required for ${rule.id}`);
  }
  for (const rule of [...manifest.integrations, ...manifest.forbiddenImports]) paths(rule.toPaths, `toPaths of ${rule.id}`);
  for (const rule of manifest.integrations) {
    if (!['adapter-to-port', 'query-port', 'application-port'].includes(rule.kind) || typeof rule.typeOnly !== 'boolean') fail(`integration kind/typeOnly: ${rule.id}`);
    if (rule.toPaths.some((p) => p.endsWith('/**') || !owned.some((owner) => matches(p, owner)))) fail(`integration must name an owned port module: ${rule.id}`);
  }
  for (const rule of manifest.forbiddenSpecifiers) {
    if (!Array.isArray(rule.specifiers) || !rule.specifiers.length || !rule.specifiers.every((v) => typeof v === 'string' && v)) fail(`specifiers of ${rule.id}`);
  }
  return manifest;
}

// This is a lexical import reader, not a TypeScript parser. Strings, comments,
// regex bodies and template text are not source; template expressions are.
function tokenize(source) {
  const tokens = [];
  let i = 0;
  const push = (kind, value, start) => tokens.push({ kind, value, start });
  const quoted = (quote) => {
    const start = i++;
    let value = '';
    while (i < source.length) {
      const c = source[i++];
      if (c === quote) return { value, start };
      if (c !== '\\') { value += c; continue; }
      const escape = source[i++];
      if (escape === '\r' || escape === '\n') {
        if (escape === '\r' && source[i] === '\n') i++;
      } else if (escape === 'u' || escape === 'x') {
        let hex;
        if (escape === 'u' && source[i] === '{') {
          const end = source.indexOf('}', ++i);
          if (end < 0) throw new Error('Unterminated Unicode escape');
          hex = source.slice(i, end); i = end + 1;
        } else {
          const length = escape === 'u' ? 4 : 2;
          hex = source.slice(i, i + length); i += length;
        }
        if (!/^[a-fA-F0-9]+$/u.test(hex)) throw new Error('Invalid string escape');
        value += String.fromCodePoint(Number.parseInt(hex, 16));
      } else value += ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0' })[escape] ?? escape;
    }
    throw new Error(`Unterminated string at offset ${start}`);
  };
  const code = (inTemplate = false) => {
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (/\s/u.test(c)) { i++; continue; }
      if (source.startsWith('//', i) || (i === 0 && source.startsWith('#!', i))) {
        const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue;
      }
      if (source.startsWith('/*', i)) {
        const end = source.indexOf('*/', i + 2);
        if (end < 0) throw new Error('Unterminated comment');
        i = end + 2; continue;
      }
      if (c === '"' || c === "'") {
        const token = quoted(c); push('string', token.value, token.start); continue;
      }
      if (c === '`') {
        const start = i++;
        let value = '', expressions = false, closed = false;
        // Barrier tokens prevent template expressions joining surrounding tokens.
        const marker = tokens.length;
        push('template-start', '`', start);
        while (i < source.length) {
          if (source[i] === '\\') { value += source.slice(i, i + 2); i += 2; continue; }
          if (source[i] === '`') { i++; closed = true; break; }
          if (source.startsWith('${', i)) {
            expressions = true; i += 2; push('punct', '{', i - 1); code(true); continue;
          }
          value += source[i++];
        }
        if (!closed) throw new Error('Unterminated template');
        if (!expressions && !value.includes('\\')) tokens[marker] = { kind: 'string', value, start };
        else push('template-end', '`', i - 1);
        continue;
      }
      const previousToken = tokens.at(-1);
      const previous = previousToken?.value;
      let afterControl = false;
      if (c === '/' && previousToken?.kind === 'punct' && previous === ')') {
        let parentheses = 1;
        for (let cursor = tokens.length - 2; cursor >= 0; cursor--) {
          if (tokens[cursor].kind !== 'punct') continue;
          if (tokens[cursor].value === ')') parentheses++;
          if (tokens[cursor].value === '(' && --parentheses === 0) {
            afterControl = ['if', 'while', 'for', 'with', 'switch', 'catch'].includes(tokens[cursor - 1]?.value);
            break;
          }
        }
      }
      if (c === '/' && (!previousToken || afterControl || (previousToken.kind !== 'string' && /^(?:=|\(|\[|\{|,|:|;|!|\?|\||&|=>|return|throw|case)$/u.test(previous)))) {
        const start = i++;
        let inClass = false, closed = false;
        while (i < source.length) {
          const r = source[i++];
          if (r === '\\') { i++; continue; }
          if (r === '[') inClass = true;
          if (r === ']') inClass = false;
          if (r === '/' && !inClass) { closed = true; break; }
          if (r === '\n') break;
        }
        if (!closed) throw new Error(`Unterminated regular expression at offset ${start}`);
        while (/[a-z]/iu.test(source[i] ?? '')) i++;
        push('regex', '', start); continue;
      }
      if (/[\w$]/u.test(c)) {
        const start = i++;
        while (/[\w$]/u.test(source[i] ?? '')) i++;
        push('word', source.slice(start, i), start); continue;
      }
      if (inTemplate && c === '}' && depth === 0) { push('punct', c, i++); return; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      if (source.startsWith('=>', i) || source.startsWith('?.', i)) {
        push('punct', source.slice(i, i + 2), i); i += 2;
      } else push('punct', c, i++);
    }
    if (inTemplate) throw new Error('Unterminated template expression');
  };
  code();
  return tokens;
}

export function extractImports(source) {
  const tokens = tokenize(source);
  const imports = [];
  const add = (token, kind, typeOnly, specifier) => imports.push({
    specifier, kind, typeOnly,
    line: source.slice(0, token.start).split('\n').length,
  });
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== 'word' || !['import', 'export', 'require'].includes(token.value)) continue;
    if (['.', '?.'].includes(tokens[i - 1]?.value)) continue;
    const next = tokens[i + 1];
    if (next?.kind === 'punct' && next.value === '(' && token.value !== 'export') {
      let closing = i + 2, parentheses = 1;
      for (; closing < tokens.length && parentheses > 0; closing++) {
        if (tokens[closing].kind === 'punct' && tokens[closing].value === '(') parentheses++;
        if (tokens[closing].kind === 'punct' && tokens[closing].value === ')') parentheses--;
      }
      // A method named require/import is not a module-loading expression.
      const argument = tokens[i + 2];
      if (argument?.kind !== 'string' && (tokens[i - 1]?.value === 'function' || tokens[closing]?.value === '{')) continue;
      const literal = argument?.kind === 'string' && [')', ','].includes(tokens[i + 3]?.value);
      add(token, token.value === 'require' ? 'require' : 'dynamic-import', false, literal ? argument.value : null);
      continue;
    }
    if (token.value === 'require' || next?.value === '.' || next?.value === ':' || next?.value === '(') continue;
    if (token.value === 'import' && next?.kind === 'string') { add(token, 'import', false, next.value); continue; }
    // Declarations only: do not search into an exported function/class body.
    if (token.value === 'export' && !['*', '{', 'type'].includes(next?.value)) continue;
    let depth = 0;
    for (let j = i + 1; j < tokens.length; j++) {
      const current = tokens[j];
      if (depth === 0 && (current.value === ';' || (j > i + 1 && ['import', 'export', '=', '('].includes(current.value)))) break;
      if (current.value === '{') depth++;
      if (current.value === '}') depth--;
      if (depth === 0 && current.value === 'from' && tokens[j + 1]?.kind === 'string') {
        const clause = tokens.slice(i + 1, j);
        const named = clause[0]?.value === '{' && clause.at(-1)?.value === '}';
        const members = named ? clause.slice(1, -1).reduce((groups, t) => {
          if (t.value === ',') groups.push([]); else groups.at(-1).push(t);
          return groups;
        }, [[]]).filter((group) => group.length) : [];
        const typeOnly = (next.value === 'type' && clause.length > 1 && clause[1].value !== ',') || (members.length > 0 && members.every((group) => group[0]?.value === 'type' && group[1]?.value !== 'as' && group.length > 1));
        add(token, token.value, typeOnly, tokens[j + 1].value); break;
      }
    }
  }
  return imports;
}

async function resolveImport(root, source, specifier, manifest) {
  // ESM query/fragment suffixes do not change the ownership of a module.
  specifier = slash(specifier).split(/[?#]/u, 1)[0];
  let target;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    target = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
  } else {
    const alias = Object.keys(manifest.aliases).sort((a, b) => b.length - a.length).find((prefix) => specifier.startsWith(prefix));
    if (!alias) return null;
    target = path.posix.normalize(`${manifest.aliases[alias]}/${specifier.slice(alias.length)}`);
  }
  if (!inside(target)) throw new Error(`Relative import escapes repository: ${specifier}`);
  const candidates = [target];
  if (scriptExtensions.test(target)) {
    for (const ext of manifest.extensions) candidates.push(`${moduleName(target)}${ext}`);
  } else {
    for (const ext of manifest.extensions) candidates.push(`${target}${ext}`);
    for (const ext of manifest.extensions) candidates.push(`${target}/index${ext}`);
  }
  for (const candidate of [...new Set(candidates)]) {
    try {
      if (!(await stat(path.resolve(root, candidate))).isFile()) continue;
      const actual = slash(path.relative(root, await realpath(path.resolve(root, candidate))));
      if (!inside(actual)) throw new Error(`Import target escapes repository through a symlink: ${specifier}`);
      return { target: actual, exists: true };
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  // Classify even an absent target: reserved contexts must not be bypassed by
  // adding a module later. A missing module alone is the compiler's concern.
  return { target, exists: false };
}

export async function checkBoundaries({ root, manifest }) {
  validateManifest(manifest);
  root = await realpath(root);
  const files = new Set(), diagnostics = [], warnings = [];
  const walk = async (relative) => {
    for (const entry of (await readdir(path.join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const file = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw new Error(`Symlink in scan root requires review: ${file}`);
      if (entry.isDirectory() && !manifest.ignoreDirectories.includes(entry.name)) await walk(file);
      else if (entry.isFile() && manifest.extensions.includes(path.extname(entry.name))) files.add(file);
    }
  };
  // Scan roots must exist, unlike the reserved context paths below them.
  for (const scanRoot of manifest.scanRoots) {
    const physical = await realpath(path.join(root, scanRoot));
    if (slash(path.relative(root, physical)) !== scanRoot) throw new Error(`scanRoot must not be a symlink: ${scanRoot}`);
    await walk(scanRoot);
  }
  const owner = (file) => manifest.contexts.find((context) => context.paths.some((selector) => matches(file, selector)))?.id ?? null;
  const applies = (rule, file, context) => rule.fromPaths?.some((selector) => matches(file, selector)) || rule.fromContexts?.includes(context);
  let importCount = 0, relativeImportCount = 0;
  const contextFiles = Object.fromEntries(manifest.contexts.map((context) => [context.id, 0]));
  for (const file of [...files].sort()) {
    const from = owner(file);
    if (from) contextFiles[from]++;
    let imports;
    try { imports = extractImports(await readFile(path.join(root, file), 'utf8')); }
    catch (error) { diagnostics.push({ code: 'SOURCE_READ_ERROR', file, line: 1, message: error.message }); continue; }
    for (const imported of imports) {
      importCount++;
      const detail = { file, ...imported, fromContext: from };
      if (imported.specifier === null) {
        warnings.push({ ...detail, code: 'COMPUTED_IMPORT', message: 'Computed module specifier is outside static resolution; review manually.' });
        continue;
      }
      const forbiddenSpecifier = manifest.forbiddenSpecifiers.find((rule) => applies(rule, file, from) && rule.specifiers.some((s) => imported.specifier === s || (s.endsWith('/') && imported.specifier.startsWith(s))));
      if (forbiddenSpecifier) {
        diagnostics.push({ ...detail, code: 'FORBIDDEN_SPECIFIER', rule: forbiddenSpecifier.id, message: forbiddenSpecifier.reason }); continue;
      }
      let resolved;
      try { resolved = await resolveImport(root, file, imported.specifier, manifest); }
      catch (error) { diagnostics.push({ ...detail, code: 'RESOLUTION_ERROR', message: error.message }); continue; }
      if (!resolved) continue;
      relativeImportCount++;
      const { target, exists } = resolved;
      const to = owner(target);
      const edge = { ...detail, target, targetExists: exists, toContext: to };
      const forbidden = manifest.forbiddenImports.find((rule) => applies(rule, file, from) && rule.toPaths.some((selector) => matches(target, selector)));
      if (forbidden) { diagnostics.push({ ...edge, code: 'FORBIDDEN_IMPORT', rule: forbidden.id, message: forbidden.reason }); continue; }
      if (!to || to === from) continue;
      if (!from && manifest.compositionRoots.some((selector) => matches(file, selector))) continue;
      if (manifest.integrations.some((rule) => applies(rule, file, from) && rule.toPaths.some((selector) => matches(target, selector)) && (!rule.typeOnly || imported.typeOnly))) continue;
      diagnostics.push({ ...edge, code: 'CROSS_CONTEXT_IMPORT', message: `Import into ${to} requires a declared Port/Adapter integration or composition root.` });
    }
  }
  return { ok: diagnostics.length === 0, scannedFiles: files.size, importCount, relativeImportCount, contextFiles, diagnostics, warnings };
}

async function main(args) {
  const options = { root: fileURLToPath(new URL('../', import.meta.url)), manifest: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') options.json = true;
    else if (['--root', '--manifest'].includes(arg) && args[i + 1] && !args[i + 1].startsWith('--')) options[arg.slice(2)] = path.resolve(args[++i]);
    else throw new Error(`Unknown or incomplete option: ${arg}. Usage: node scripts/architecture-boundaries.mjs [--root DIR] [--manifest FILE] [--json]`);
  }
  const manifest = JSON.parse(await readFile(options.manifest ?? path.join(options.root, 'architecture-boundaries.json'), 'utf8'));
  const result = await checkBoundaries({ root: options.root, manifest });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`${result.ok ? 'PASS' : 'FAIL'}: ${result.scannedFiles} source files, ${result.importCount} imports, ${result.diagnostics.length} violations, ${result.warnings.length} review warnings.`);
    for (const context of manifest.contexts) console.log(`  ${context.id}: ${result.contextFiles[context.id]} files (${context.status})`);
    for (const diagnostic of [...result.diagnostics, ...result.warnings]) console.log(`${diagnostic.file}:${diagnostic.line} [${diagnostic.code}] ${diagnostic.specifier ?? ''} ${diagnostic.message}`);
  }
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => { console.error(`Boundary guard error: ${error.message}`); process.exitCode = 2; });
}
