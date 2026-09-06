import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const srcRoot = join(dirname(fileURLToPath(import.meta.url)));

function productionSourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...productionSourceFiles(path));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(path);
    }
  }
  return files;
}

describe('ledger-application package boundary', () => {
  it('does not depend on Nest, Stripe, or payment-application', () => {
    const pkg = JSON.parse(readFileSync(join(srcRoot, '../package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@fraterunion-payments/ledger-core']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/database']).toBe('workspace:*');
    expect(pkg.dependencies?.['@nestjs/common']).toBeUndefined();
    expect(pkg.dependencies?.['@fraterunion-payments/provider-stripe']).toBeUndefined();
    expect(pkg.dependencies?.['@fraterunion-payments/payment-application']).toBeUndefined();
  });

  it('contains no provider SDK or payment-execution concepts', () => {
    const forbidden = ['PaymentIntent', '@nestjs', "from 'stripe'", 'from "stripe"'];
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
