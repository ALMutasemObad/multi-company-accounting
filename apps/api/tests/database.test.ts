import { describe, expect, it } from 'vitest';
import { databaseUrlWithPoolOptions } from '../src/database.js';

describe('database connection pool configuration', () => {
  it('applies explicit per-process pool settings while preserving other URL options', () => {
    const configured = new URL(databaseUrlWithPoolOptions(
      'mysql://runtime:secret@db.internal:3306/mcap?ssl=true',
      {
        connectionLimit: 6,
        minimumIdle: 1,
        acquireTimeoutMs: 4_000,
        connectTimeoutMs: 800,
        idleTimeoutSeconds: 300,
      },
    ));

    expect(configured.searchParams.get('ssl')).toBe('true');
    expect(configured.searchParams.get('connectionLimit')).toBe('6');
    expect(configured.searchParams.get('minimumIdle')).toBe('1');
    expect(configured.searchParams.get('acquireTimeout')).toBe('4000');
    expect(configured.searchParams.get('connectTimeout')).toBe('800');
    expect(configured.searchParams.get('idleTimeout')).toBe('300');
  });
});
