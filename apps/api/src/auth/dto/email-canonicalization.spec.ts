import type { ArgumentMetadata } from '@nestjs/common';
import { createValidationPipe } from '../../common/pipes/validation-pipe.factory';
import { LoginDto } from './login.dto';
import { RegisterDto } from './register.dto';

const REGISTER_METADATA: ArgumentMetadata = { type: 'body', metatype: RegisterDto, data: '' };
const LOGIN_METADATA: ArgumentMetadata = { type: 'body', metatype: LoginDto, data: '' };

const VALID_REGISTER = {
  password: 'a sufficiently long passphrase',
  organizationName: 'Acme Gym',
  organizationSlug: 'acme-gym',
  defaultCurrency: 'USD',
  countryCode: 'US',
  timezone: 'America/New_York',
};

describe('email canonicalization on auth DTOs', () => {
  it('stores the canonical form from a mixed-case registration email', async () => {
    const pipe = createValidationPipe();
    const result = (await pipe.transform(
      { ...VALID_REGISTER, email: 'Owner@Example.com' },
      REGISTER_METADATA,
    )) as RegisterDto;

    expect(result.email).toBe('owner@example.com');
  });

  it('canonicalizes a differently-cased login email the same way', async () => {
    const pipe = createValidationPipe();
    const result = (await pipe.transform(
      { email: '  OWNER@example.com  ', password: 'a sufficiently long passphrase' },
      LOGIN_METADATA,
    )) as LoginDto;

    expect(result.email).toBe('owner@example.com');
  });
});
