import { accessSync, constants, mkdtempSync, realpathSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, delimiter, isAbsolute, join } from 'node:path';

const forbidden = /DATABASE|(^|_)(DB|MYSQL|MARIADB)(_|$)|^DIRECT_URL$|^RUN_.*DB_TESTS$|SMTP|MAILGUN|SENDGRID|POSTMARK|RESEND|(^|_)MAIL(_|$)|(^|_)EMAIL(_|$)|PAYMENT|PAYPAL|STRIPE|ADYEN|MYFATOORAH|HYPERPAY|CHECKOUT|(^|_)TAP(_|$)|(^|_)TELR(_|$)/i;
const chromiumSocketSuffix = join('temp', 'org.chromium.Chromium.XXXXXX', 'SingletonSocket');
const safeUnixSocketPathBytes = 100;

function checkedRuntimeBase(candidate) {
  if (!isAbsolute(candidate) || /^[\\/]{2}/.test(candidate)) {
    throw new Error('The Linux acceptance runtime base must be an absolute local path.');
  }
  let canonical;
  try {
    canonical = realpathSync(candidate);
    if (/^[\\/]{2}/.test(canonical) || !statSync(canonical).isDirectory()) throw new Error();
  } catch {
    throw new Error('The Linux acceptance runtime base must be an existing local directory.');
  }
  const projectedSocket = join(canonical, 'sa-XXXXXX', chromiumSocketSuffix);
  if (Buffer.byteLength(projectedSocket) > safeUnixSocketPathBytes) {
    throw new Error('The Linux acceptance runtime base is too long for Chromium singleton sockets.');
  }
  return canonical;
}

export function createAcceptanceRuntimeRoot(run, env, platform = process.platform, systemTemp = tmpdir()) {
  if (platform === 'win32') return run;
  const base = checkedRuntimeBase(env.RUNNER_TEMP ?? systemTemp);
  return mkdtempSync(join(base, 'sa-'));
}

export function assertLocalBrowserFile(browser) {
  // Reject relative paths, directories and network shares, without logging paths
  // or silently selecting another browser when the chosen installation is invalid.
  try {
    if (!isAbsolute(browser) || /^[\\/]{2}/.test(browser)) throw new Error();
    if (/^[\\/]{2}/.test(realpathSync(browser)) || !statSync(browser).isFile()) throw new Error();
    if (process.platform !== 'win32') accessSync(browser, constants.X_OK);
  } catch {
    throw new Error('Selected Chromium must be an existing local executable file; this gate does not install or substitute browsers.');
  }
}

export async function prepareAcceptanceEnvironment(env, run, nodeExecutable, resolveInstalledBrowser, runtime = run, platform = process.platform) {
  Object.assign(env, {
    TEMP: join(runtime, 'temp'), TMP: join(runtime, 'temp'), TMPDIR: join(runtime, 'temp'),
    npm_config_cache: join(runtime, 'cache/npm'), NODE_OPTIONS: '--max-old-space-size=768',
    NODE_DISABLE_COMPILE_CACHE: '1', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  delete env.NODE_COMPILE_CACHE;
  // Playwright resolves its read-only installation using the original registry
  // environment. Do not move XDG or Windows profile paths before this callback.
  const browser = env.SUBSCRIPTION_BROWSER_EXECUTABLE_PATH ?? await resolveInstalledBrowser();
  Object.assign(env, {
    XDG_CACHE_HOME: join(runtime, 'cache'), XDG_CONFIG_HOME: join(runtime, 'profile'),
    USERPROFILE: join(runtime, 'profile'), APPDATA: join(runtime, 'profile/roaming'), LOCALAPPDATA: join(runtime, 'profile/local'),
    PATH: `${dirname(nodeExecutable)}${delimiter}${env.PATH ?? ''}`,
    SUBSCRIPTION_ACCEPTANCE_RUN_DIR: run, SUBSCRIPTION_ACCEPTANCE_BROWSER_PATH: browser,
  });
  if (platform !== 'win32') env.HOME = join(runtime, 'profile');
  let removed = 0;
  for (const name of Object.keys(env)) {
    if (forbidden.test(name)) { delete env[name]; removed += 1; }
  }
  return { browser, removed };
}
