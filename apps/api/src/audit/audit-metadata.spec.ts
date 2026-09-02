import { assertSafeAuditMetadata, UnsafeAuditMetadataError } from './audit-metadata';

describe('assertSafeAuditMetadata', () => {
  it('accepts a small safe object', () => {
    expect(assertSafeAuditMetadata({ role: 'OWNER', keyPrefix: 'fup_test_ab' })).toEqual({
      role: 'OWNER',
      keyPrefix: 'fup_test_ab',
    });
  });

  it('rejects forbidden keys including nested camelCase and snake_case', () => {
    expect(() => assertSafeAuditMetadata({ password: 'x' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ passwordHash: 'x' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ refresh_token: 'x' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ nested: { apiKey: 'x' } })).toThrow(
      UnsafeAuditMetadataError,
    );
    expect(() => assertSafeAuditMetadata({ authorization: 'Bearer x' })).toThrow(
      UnsafeAuditMetadataError,
    );
    expect(() => assertSafeAuditMetadata({ cookie: 'sid=1' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ cardNumber: '4111' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ cvc: '123' })).toThrow(UnsafeAuditMetadataError);
    expect(() => assertSafeAuditMetadata({ databaseUrl: 'postgresql://x' })).toThrow(
      UnsafeAuditMetadataError,
    );
  });

  it('rejects forbidden values even under a safe key', () => {
    expect(() =>
      assertSafeAuditMetadata({
        note: 'postgresql://user:supersecret@localhost:5432/db',
      }),
    ).toThrow(UnsafeAuditMetadataError);
    expect(() =>
      assertSafeAuditMetadata({
        note: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.abc',
      }),
    ).toThrow(UnsafeAuditMetadataError);
  });

  it('rejects excessive nesting', () => {
    let nested: Record<string, unknown> = { leaf: true };
    for (let index = 0; index < 10; index += 1) {
      nested = { child: nested };
    }
    expect(() => assertSafeAuditMetadata(nested)).toThrow(/nesting depth/);
  });
});
