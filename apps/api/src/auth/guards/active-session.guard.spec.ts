import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { SessionService } from '../services/session.service';
import type { AuthenticatedRequest } from '../types/authenticated-request.type';
import { ActiveSessionGuard } from './active-session.guard';

function createContext(request: Partial<AuthenticatedRequest>): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

function createFakeSessionService(active: boolean): Pick<SessionService, 'isSessionActive'> {
  return { isSessionActive: jest.fn().mockResolvedValue(active) };
}

describe('ActiveSessionGuard', () => {
  it('rejects when no principal has been attached', async () => {
    const guard = new ActiveSessionGuard(createFakeSessionService(true) as SessionService);
    const context = createContext({});

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('is a no-op for an API_KEY principal', async () => {
    const sessionService = createFakeSessionService(false);
    const guard = new ActiveSessionGuard(sessionService as SessionService);
    const context = createContext({
      principal: {
        type: 'API_KEY',
        apiKeyId: 'key-1',
        organizationId: 'org-1',
        environment: 'TEST',
        scopes: [],
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessionService.isSessionActive).not.toHaveBeenCalled();
  });

  it('allows a USER principal with an active session', async () => {
    const guard = new ActiveSessionGuard(createFakeSessionService(true) as SessionService);
    const context = createContext({
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a USER principal whose session is no longer active', async () => {
    const guard = new ActiveSessionGuard(createFakeSessionService(false) as SessionService);
    const context = createContext({
      principal: { type: 'USER', userId: 'user-1', sessionId: 'session-1', email: 'a@example.com' },
    });

    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });
});
