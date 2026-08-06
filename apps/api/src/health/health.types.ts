export interface LivenessResult {
  readonly status: 'ok';
  readonly service: string;
  readonly check: 'liveness';
  readonly timestamp: string;
}

export interface ReadinessResult {
  readonly status: 'ok' | 'error';
  readonly service: string;
  readonly check: 'readiness';
  readonly dependencies: {
    readonly database: 'up' | 'down';
  };
  readonly timestamp: string;
}
