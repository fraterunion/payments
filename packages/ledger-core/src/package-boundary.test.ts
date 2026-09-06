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

describe('ledger-core package boundary', () => {
  it('contains no provider or payment-execution concepts', () => {
    const forbidden = [
      'stripe',
      'PaymentIntent',
      'RefundProviderExecution',
      'PaymentProviderExecution',
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
