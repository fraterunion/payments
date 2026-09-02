import { CustomerValidationException } from './customer.exceptions';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164_PATTERN = /^\+[1-9]\d{1,14}$/;
const CONTROL_MAX = 31;
const DELETE_CHAR = 127;

export function canonicalizeCustomerEmail(value: string): string {
  const email = rejectControlCharacters(value.trim().toLowerCase(), 'email');
  if (email.length === 0 || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new CustomerValidationException('Customer email must be a valid email address.');
  }
  return email;
}

export function canonicalizeCustomerPhone(value: string): string {
  const phone = rejectControlCharacters(value.trim(), 'phone');
  if (!E164_PATTERN.test(phone)) {
    throw new CustomerValidationException('Customer phone must be a valid E.164 number.');
  }
  return phone;
}

export function canonicalizeOptionalText(value: string, label: string, maxLength: number): string {
  const text = rejectControlCharacters(value.trim(), label);
  if (text.length === 0) {
    throw new CustomerValidationException(`Customer ${label} must be non-empty when provided.`);
  }
  if (text.length > maxLength) {
    throw new CustomerValidationException(
      `Customer ${label} must be at most ${maxLength} characters.`,
    );
  }
  return text;
}

function rejectControlCharacters(value: string, label: string): string {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= CONTROL_MAX || code === DELETE_CHAR) {
      throw new CustomerValidationException(
        `Customer ${label} must not contain control characters.`,
      );
    }
  }
  return value;
}
