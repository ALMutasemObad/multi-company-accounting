import { describe, expect, it } from 'vitest';
import { currencyDefinitions } from '../src/platform/reference-data.js';

describe('currency reference data', () => {
  it('includes the Yemeni rial with its ISO code and accounting precision', () => {
    expect(currencyDefinitions).toContainEqual({ code: 'YER', nameAr: 'ريال يمني', decimals: 2 });
  });

  it('keeps currency codes unique and ISO-shaped', () => {
    const codes = currencyDefinitions.map(({ code }) => code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((code) => /^[A-Z]{3}$/u.test(code))).toBe(true);
  });
});
