import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('payment-application package', () => {
  it('composes events, provider-stripe, payment-core, and database', () => {
    const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies?.['@fraterunion-payments/events']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/provider-stripe']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/payment-core']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/database']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/ledger-application']).toBe('workspace:*');
    expect(pkg.dependencies?.['@fraterunion-payments/ledger-core']).toBe('workspace:*');
  });

  it('exports the Stripe financial inbox processor', async () => {
    const application = await import('./index.js');
    expect(typeof application.processStripeInboxEvent).toBe('function');
  });
});
