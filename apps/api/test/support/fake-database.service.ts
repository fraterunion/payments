/**
 * Controlled substitute for `DatabaseService` used in e2e tests, so most of
 * the suite never needs a real PostgreSQL instance. Implements only the
 * members other providers actually call in this commit (`isReady`).
 */
export class FakeDatabaseService {
  private ready = true;

  setReady(ready: boolean): void {
    this.ready = ready;
  }

  onModuleInit(): void {
    // no-op: nothing to connect to.
  }

  onModuleDestroy(): void {
    // no-op: nothing to disconnect from.
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  getClient(): never {
    throw new Error(
      'FakeDatabaseService.getClient() is not supported; this commit has no queries.',
    );
  }
}
