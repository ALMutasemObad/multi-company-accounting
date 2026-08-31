import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { dirname, delimiter, isAbsolute, join } from 'node:path';

const forbidden = /DATABASE|(^|_)(DB|MYSQL|MARIADB)(_|$)|^DIRECT_URL$|^RUN_.*DB_TESTS$|SMTP|MAILGUN|SENDGRID|POSTMARK|RESEND|(^|_)MAIL(_|$)|(^|_)EMAIL(_|$)|PAYMENT|PAYPAL|STRIPE|ADYEN|MYFATOORAH|HYPERPAY|CHECKOUT|(^|_)TAP(_|$)|(^|_)TELR(_|$)/i;

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

export async function prepareAcceptanceEnvironment(env, run, nodeExecutable, resolveInstalledBrowser) {
  Object.assign(env, {
    TEMP: join(run, 'temp'), TMP: join(run, 'temp'), TMPDIR: join(run, 'temp'),
    npm_config_cache: join(run, 'cache/npm'), NODE_OPTIONS: '--max-old-space-size=768',
    NODE_DISABLE_COMPILE_CACHE: '1', GOMAXPROCS: '2', GOMEMLIMIT: '1536MiB',
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  });
  delete env.NODE_COMPILE_CACHE;
  // Playwright resolves its read-only installation using the original registry
  // environment. Do not move XDG or Windows profile paths before this callback.
  const browser = env.SUBSCRIPTION_BROWSER_EXECUTABLE_PATH ?? await resolveInstalledBrowser();
  Object.assign(env, {
    XDG_CACHE_HOME: join(run, 'cache'), XDG_CONFIG_HOME: join(run, 'profile'),
    USERPROFILE: join(run, 'profile'), APPDATA: join(run, 'profile/roaming'), LOCALAPPDATA: join(run, 'profile/local'),
    PATH: `${dirname(nodeExecutable)}${delimiter}${env.PATH ?? ''}`,
    SUBSCRIPTION_ACCEPTANCE_RUN_DIR: run, SUBSCRIPTION_ACCEPTANCE_BROWSER_PATH: browser,
  });
  let removed = 0;
  for (const name of Object.keys(env)) {
    if (forbidden.test(name)) { delete env[name]; removed += 1; }
  }
  return { browser, removed };
}
