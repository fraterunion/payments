import { BadRequestException, HttpStatus, NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';
import { ValidationException } from '../exceptions/validation.exception';
import { GlobalExceptionFilter } from './global-exception.filter';

function createMockLogger(): jest.Mocked<Pick<PinoLogger, 'setContext' | 'error' | 'warn'>> {
  return {
    setContext: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  };
}

function createMockHost(requestId: string): {
  host: ArgumentsHost;
  json: jest.Mock;
  status: jest.Mock;
} {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const request = { id: requestId };
  const response = { status };

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
      getNext: () => undefined,
    }),
    getArgs: () => [request, response],
    getArgByIndex: () => undefined,
    switchToRpc: () => {
      throw new Error('not implemented');
    },
    switchToWs: () => {
      throw new Error('not implemented');
    },
    getType: () => 'http',
  } as unknown as ArgumentsHost;

  return { host, json, status };
}

describe('GlobalExceptionFilter', () => {
  it('returns a VALIDATION_ERROR envelope with field-level details', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json, status } = createMockHost('req-1');

    filter.catch(
      new ValidationException([{ field: 'email', message: 'email must be an email' }]),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        requestId: 'req-1',
        details: [{ field: 'email', message: 'email must be an email' }],
      },
    });
  });

  it('returns a NOT_FOUND envelope for a 404 HttpException', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json, status } = createMockHost('req-2');

    filter.catch(new NotFoundException('Cannot GET /unknown-route'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'NOT_FOUND',
        message: 'Cannot GET /unknown-route',
        requestId: 'req-2',
      },
    });
  });

  it('maps a known 4xx HttpException without treating it as a server failure', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json, status } = createMockHost('req-3');

    filter.catch(new BadRequestException('Malformed request'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0]?.[0]).toMatchObject({
      error: { code: 'BAD_REQUEST', requestId: 'req-3' },
    });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it('returns a generic INTERNAL_ERROR envelope for an unexpected error, without leaking the message', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json, status } = createMockHost('req-4');

    filter.catch(new Error('leaked secret detail: db password is hunter2'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred.',
        requestId: 'req-4',
      },
    });
    const serializedResponse = JSON.stringify(json.mock.calls[0]?.[0]);
    expect(serializedResponse).not.toContain('hunter2');
    expect(serializedResponse).not.toContain('leaked secret detail');
  });

  it('never includes a stack trace in the HTTP response body', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json } = createMockHost('req-5');
    const error = new Error('boom');

    filter.catch(error, host);

    const serializedResponse = JSON.stringify(json.mock.calls[0]?.[0]);
    expect(serializedResponse).not.toContain('at ');
    expect(serializedResponse).not.toContain(error.stack);
  });

  it('logs 5xx errors at error level with the request id and stack, and warns (not errors) on 4xx', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host: host5xx } = createMockHost('req-6');
    const { host: host4xx } = createMockHost('req-7');

    filter.catch(new Error('unexpected'), host5xx);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-6', status: 500 }),
      'Unhandled error',
    );

    filter.catch(new NotFoundException(), host4xx);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'req-7', status: 404 }),
      'Request failed',
    );
  });

  it('always includes the request id, even without details', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json } = createMockHost('req-8');

    filter.catch(new NotFoundException('nope'), host);

    expect(json.mock.calls[0]?.[0]).toMatchObject({ error: { requestId: 'req-8' } });
  });

  it('maps an oversized body to PAYLOAD_TOO_LARGE without leaking the entity', () => {
    const logger = createMockLogger();
    const filter = new GlobalExceptionFilter(logger as unknown as PinoLogger);
    const { host, json, status } = createMockHost('req-9');
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      statusCode: 413,
      type: 'entity.too.large',
    });

    filter.catch(error, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
        requestId: 'req-9',
      },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
