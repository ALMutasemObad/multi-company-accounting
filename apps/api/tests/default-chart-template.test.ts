import { describe, expect, it } from 'vitest';
import { defaultChartDefinitions } from '../src/accounts/default-chart-template.js';

describe('default chart template contract', () => {
  it('has stable unique keys and codes with parents declared before children', () => {
    expect(defaultChartDefinitions).toHaveLength(60);
    expect(new Set(defaultChartDefinitions.map(({ key }) => key)).size).toBe(defaultChartDefinitions.length);
    expect(new Set(defaultChartDefinitions.map(({ code }) => code)).size).toBe(defaultChartDefinitions.length);
    const seen = new Map<string, (typeof defaultChartDefinitions)[number]>();
    for (const definition of defaultChartDefinitions) {
      if (definition.parentKey) {
        const parent = seen.get(definition.parentKey);
        expect(parent, `missing parent ${definition.parentKey} for ${definition.key}`).toBeDefined();
        expect(parent?.allowsPosting, `posting parent ${definition.parentKey}`).toBe(false);
        expect(parent?.accountTypeCode).toBe(definition.accountTypeCode);
      }
      seen.set(definition.key, definition);
    }
  });

  it('keeps every control account postable and every leaf structurally valid', () => {
    const parentKeys = new Set(defaultChartDefinitions.map(({ parentKey }) => parentKey).filter(Boolean));
    for (const definition of defaultChartDefinitions) {
      if (parentKeys.has(definition.key)) expect(definition.allowsPosting).toBe(false);
      if (definition.isControlAccount) expect(definition.allowsPosting).toBe(true);
    }
  });
});
