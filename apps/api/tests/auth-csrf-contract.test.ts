import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { csrfModeSchema, csrfModes } from '../src/auth/auth-router.js';

describe('authenticated CSRF OpenAPI query contract', () => {
  it('keeps the router enum and default aligned with OpenAPI', () => {
    const contract = parse(readFileSync(new URL('../../../packages/contracts/openapi.yaml', import.meta.url), 'utf8'));
    const operation = contract.paths['/auth/csrf'].get;
    const mode = operation.parameters.find((parameter: { name?: string; in?: string }) => parameter.name === 'mode' && parameter.in === 'query');

    expect(mode.schema.enum).toEqual([...csrfModes]);
    expect(mode.schema.default).toBe(csrfModeSchema.parse(undefined));
    expect(operation.security).toEqual([{}, { SessionCookie: [] }]);
    expect(contract.components.schemas.CsrfTokenResponse.required).toEqual(['csrfToken', 'expiresAt']);
    expect(() => csrfModeSchema.parse('unsupported')).toThrow();
  });
});
