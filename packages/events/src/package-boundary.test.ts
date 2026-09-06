import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = join(packageRoot, 'src');

function productionSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test') {
        continue;
      }
      files.push(...productionSourceFiles(path));
      continue;
    }
    if (!entry.name.endsWith('.ts')) {
      continue;
    }
    if (entry.name.endsWith('.test.ts') || entry.name.endsWith('.integration.test.ts')) {
      continue;
    }
    files.push(path);
  }
  return files;
}

describe('events package boundary', () => {
  it('does not depend on provider-stripe or payment-core', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    expect(deps['@fraterunion-payments/provider-stripe']).toBeUndefined();
    expect(deps['@fraterunion-payments/payment-core']).toBeUndefined();
  });

  it('contains no Stripe financial processing in production sources', () => {
    const forbidden = [
      'provider-stripe',
      'PaymentIntent',
      'RefundProviderExecution',
      'PaymentProviderExecution',
      'processStripeInboxEvent',
      'normalizeStripeFinancialEvent',
    ];
    const matches: string[] = [];
    for (const file of productionSourceFiles(srcRoot)) {
      const contents = readFileSync(file, 'utf8');
      for (const token of forbidden) {
        if (contents.includes(token)) {
          matches.push(`${file}: ${token}`);
        }
      }
    }
    expect(matches).toEqual([]);
  });
});
