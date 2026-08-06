import { HttpStatus, type ArgumentMetadata } from '@nestjs/common';
import { IsEmail, IsInt, Min } from 'class-validator';
import { ValidationException } from '../exceptions/validation.exception';
import { createValidationPipe } from './validation-pipe.factory';

/**
 * Fixture DTO used only by this test, to prove the global ValidationPipe is
 * configured correctly (transform, whitelist, stable error shape) without
 * attaching it to a real endpoint or adding fake business functionality.
 */
class SampleDto {
  @IsEmail()
  email!: string;

  @IsInt()
  @Min(0)
  quantity!: number;
}

const METADATA: ArgumentMetadata = { type: 'body', metatype: SampleDto, data: '' };

describe('createValidationPipe', () => {
  it('transforms and accepts a valid payload', async () => {
    const pipe = createValidationPipe();

    // A JSON body already carries real primitive types (unlike query
    // strings), so `quantity` is a number here, not a numeric string.
    const result = await pipe.transform({ email: 'dev@fraterunion.local', quantity: 3 }, METADATA);

    expect(result).toBeInstanceOf(SampleDto);
    expect(result.quantity).toBe(3);
  });

  it('rejects a payload containing a field not declared on the DTO', async () => {
    const pipe = createValidationPipe();

    // whitelist + forbidNonWhitelisted together mean unexpected fields are
    // rejected outright, per the global validation requirements — not
    // silently stripped.
    await expect(
      pipe.transform(
        { email: 'dev@fraterunion.local', quantity: 1, unexpectedField: 'nope' },
        METADATA,
      ),
    ).rejects.toBeInstanceOf(ValidationException);
  });

  it('throws a ValidationException carrying field-level details for invalid input', async () => {
    const pipe = createValidationPipe();

    try {
      await pipe.transform({ email: 'not-an-email', quantity: -1 }, METADATA);
      throw new Error('expected pipe.transform to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationException);
      const exception = error as ValidationException;
      expect(exception.code).toBe('VALIDATION_ERROR');
      expect(exception.getStatus()).toBe(HttpStatus.BAD_REQUEST);
      expect(exception.details?.some((detail) => detail.field === 'email')).toBe(true);
      expect(exception.details?.some((detail) => detail.field === 'quantity')).toBe(true);
    }
  });

  it('does not leak internal class/type names in the exception message', async () => {
    const pipe = createValidationPipe();

    await expect(pipe.transform({ email: 'bad' }, METADATA)).rejects.toMatchObject({
      message: 'Request validation failed.',
    });
  });
});
