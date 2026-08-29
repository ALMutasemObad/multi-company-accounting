export type DatabasePoolOptions = {
  connectionLimit: number;
  minimumIdle: number;
  acquireTimeoutMs: number;
  connectTimeoutMs: number;
  idleTimeoutSeconds: number;
};

export const defaultDatabasePoolOptions: DatabasePoolOptions = {
  connectionLimit: 10,
  minimumIdle: 1,
  acquireTimeoutMs: 10_000,
  connectTimeoutMs: 1_000,
  idleTimeoutSeconds: 1_800,
};

const connectorParameters = (options: DatabasePoolOptions) => ({
  connectionLimit: options.connectionLimit.toString(),
  minimumIdle: options.minimumIdle.toString(),
  acquireTimeout: options.acquireTimeoutMs.toString(),
  connectTimeout: options.connectTimeoutMs.toString(),
  idleTimeout: options.idleTimeoutSeconds.toString(),
});

export function databaseUrlWithPoolOptions(databaseUrl: string, options: DatabasePoolOptions) {
  const url = new URL(databaseUrl);
  for (const [name, value] of Object.entries(connectorParameters(options))) url.searchParams.set(name, value);
  return url.toString();
}

export function databaseUrlWithDefaultPoolOptions(databaseUrl: string) {
  const url = new URL(databaseUrl);
  for (const [name, value] of Object.entries(connectorParameters(defaultDatabasePoolOptions))) {
    if (!url.searchParams.has(name)) url.searchParams.set(name, value);
  }
  return url.toString();
}
