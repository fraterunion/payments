import type { AppConfigService } from '../../config/app-config.service';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, PasswordService } from './password.service';

function createFakeAppConfig(): Pick<
  AppConfigService,
  'passwordArgon2MemoryKib' | 'passwordArgon2TimeCost' | 'passwordArgon2Parallelism'
> {
  return {
    passwordArgon2MemoryKib: 8192,
    passwordArgon2TimeCost: 2,
    passwordArgon2Parallelism: 1,
  };
}

describe('PasswordService', () => {
  function createService(): PasswordService {
    return new PasswordService(createFakeAppConfig() as AppConfigService);
  }

  describe('validatePolicy', () => {
    it('rejects a password shorter than the minimum length', () => {
      const service = createService();
      const error = service.validatePolicy('short');
      expect(error).toContain(String(PASSWORD_MIN_LENGTH));
    });

    it('rejects a password longer than the maximum length', () => {
      const service = createService();
      const error = service.validatePolicy('a'.repeat(PASSWORD_MAX_LENGTH + 1));
      expect(error).toContain(String(PASSWORD_MAX_LENGTH));
    });

    it('accepts a long passphrase with no symbols or uppercase', () => {
      const service = createService();
      expect(service.validatePolicy('correct horse battery staple words')).toBeUndefined();
    });

    it('accepts a password at exactly the minimum length', () => {
      const service = createService();
      expect(service.validatePolicy('a'.repeat(PASSWORD_MIN_LENGTH))).toBeUndefined();
    });
  });

  describe('hash / verify', () => {
    it('produces an argon2id hash string', async () => {
      const service = createService();
      const hash = await service.hash('a sufficiently long passphrase');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('verifies the correct password', async () => {
      const service = createService();
      const hash = await service.hash('a sufficiently long passphrase');
      await expect(service.verify(hash, 'a sufficiently long passphrase')).resolves.toBe(true);
    });

    it('rejects an incorrect password', async () => {
      const service = createService();
      const hash = await service.hash('a sufficiently long passphrase');
      await expect(service.verify(hash, 'a different passphrase entirely')).resolves.toBe(false);
    });

    it('never throws for a malformed stored hash, returning false instead', async () => {
      const service = createService();
      await expect(service.verify('not-a-real-hash', 'anything')).resolves.toBe(false);
    });
  });

  describe('needsRehash', () => {
    it('is false for a hash produced with the current parameters', async () => {
      const service = createService();
      const hash = await service.hash('a sufficiently long passphrase');
      expect(service.needsRehash(hash)).toBe(false);
    });

    it('is true for a hash produced with different cost parameters', async () => {
      const service = createService();
      const hash = await service.hash('a sufficiently long passphrase');

      const stricterConfig = { ...createFakeAppConfig(), passwordArgon2TimeCost: 5 };
      const stricterService = new PasswordService(stricterConfig as AppConfigService);

      expect(stricterService.needsRehash(hash)).toBe(true);
    });
  });

  describe('verifyDummy', () => {
    it('resolves without throwing regardless of the input', async () => {
      const service = createService();
      await expect(service.verifyDummy('literally anything')).resolves.toBeUndefined();
    });

    it('computes its dummy hash only once across multiple calls', async () => {
      const service = createService();
      const hashSpy = jest.spyOn(service, 'hash');

      await service.verifyDummy('first attempt');
      await service.verifyDummy('second attempt');

      expect(hashSpy).toHaveBeenCalledTimes(1);
    });
  });
});
