import { Controller, Get, HttpStatus, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';
import type { LivenessResult, ReadinessResult } from './health.types';

/**
 * Deliberately outside the versioned `/api/v1` surface and not routed
 * through `GlobalExceptionFilter` for the readiness-failure case: a 503
 * here is a status report with its own fixed shape, not a client error.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOkResponse({ description: 'The process is running and able to respond.' })
  liveness(): LivenessResult {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOkResponse({
    description: 'The application is initialized and its database dependency is reachable.',
  })
  @ApiServiceUnavailableResponse({ description: 'A required dependency is unreachable.' })
  async readiness(@Res({ passthrough: true }) res: Response): Promise<ReadinessResult> {
    const result = await this.healthService.getReadiness();
    if (result.status !== 'ok') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result;
  }
}
