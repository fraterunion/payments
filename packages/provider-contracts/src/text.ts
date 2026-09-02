import { ProviderContractError, PROVIDER_ERROR_CODES } from './errors.js';
import type { ProviderErrorCode } from './errors.js';

function hasControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) {
      return true;
    }
  }
  return false;
}

export function requireBoundedText(
  value: string,
  label: string,
  maxLength: number,
  code: ProviderErrorCode = PROVIDER_ERROR_CODES.INVALID_PROVIDER_REFERENCE,
): string {
  if (typeof value !== 'string') {
    throw new ProviderContractError(`${label} must be a string.`, { code });
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ProviderContractError(`${label} is required.`, { code });
  }
  if (trimmed.length > maxLength) {
    throw new ProviderContractError(`${label} must be at most ${maxLength} characters.`, { code });
  }
  if (hasControlCharacters(trimmed)) {
    throw new ProviderContractError(`${label} must not contain control characters.`, { code });
  }
  return trimmed;
}

export function rejectControlCharacters(
  value: string,
  label: string,
  code: ProviderErrorCode,
): void {
  if (hasControlCharacters(value)) {
    throw new ProviderContractError(`${label} must not contain control characters.`, { code });
  }
}
