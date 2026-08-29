import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';
import {
  databaseUrlWithDefaultPoolOptions,
  databaseUrlWithPoolOptions,
  type DatabasePoolOptions,
} from './database-pool-options.js';

export { databaseUrlWithPoolOptions, defaultDatabasePoolOptions } from './database-pool-options.js';
export type { DatabasePoolOptions } from './database-pool-options.js';

export function createDatabase(
  databaseUrl: string,
  poolOptions?: DatabasePoolOptions,
): PrismaClient {
  const configuredUrl = poolOptions
    ? databaseUrlWithPoolOptions(databaseUrl, poolOptions)
    : databaseUrlWithDefaultPoolOptions(databaseUrl);
  return new PrismaClient({ adapter: new PrismaMariaDb(configuredUrl) });
}
