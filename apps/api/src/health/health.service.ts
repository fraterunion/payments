import { Injectable } from '@nestjs/common';
import { SERVICE_ID } from '../common/constants/service.constants';
import { DatabaseService } from '../database/database.service';
import type { LivenessResult, ReadinessResult } from './health.types';

@Injectable()
export class HealthService {
  constructor(private readonly databaseService: DatabaseService) {}

  /**
   * Liveness never checks the database — a temporarily unavailable
   * dependency should not cause an orchestrator to restart a process that
   * is otherwise running fine.
   */
  getLiveness(): LivenessResult {
    return {
      status: 'ok',
      service: SERVICE_ID,
      check: 'liveness',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness(): Promise<ReadinessResult> {
    const databaseUp = await this.databaseService.isReady();

    return {
      status: databaseUp ? 'ok' : 'error',
      service: SERVICE_ID,
      check: 'readiness',
      dependencies: { database: databaseUp ? 'up' : 'down' },
      timestamp: new Date().toISOString(),
    };
  }
}
