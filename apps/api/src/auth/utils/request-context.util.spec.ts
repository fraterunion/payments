import { extractRequestContext } from './request-context.util';

describe('extractRequestContext', () => {
  it('copies only request id, IP, and a bounded user-agent', () => {
    const context = extractRequestContext({
      id: 'req-1',
      ip: '203.0.113.10',
      headers: {
        'user-agent': 'a'.repeat(600),
        authorization: 'Bearer secret-token',
        cookie: 'sid=abc',
        'x-api-key': 'fup_test_should_not_copy',
      },
    } as never);

    expect(context).toEqual({
      requestId: 'req-1',
      ipAddress: '203.0.113.10',
      userAgent: 'a'.repeat(512),
    });
    expect(JSON.stringify(context)).not.toMatch(/secret-token|sid=abc|fup_test_should_not_copy/);
  });
});
