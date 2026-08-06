import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { PRODUCT_NAME } from '../common/constants/service.constants';
import { AppConfigService } from '../config/app-config.service';
import type { RootResult } from './root.types';

/** Not a health endpoint: confirms the versioned API is reachable, nothing more. */
@ApiTags('Root')
@Controller()
export class RootController {
  constructor(private readonly appConfig: AppConfigService) {}

  @Get()
  @ApiOkResponse({ description: 'Confirms the versioned API is reachable.' })
  getRoot(): RootResult {
    return {
      service: PRODUCT_NAME,
      version: `v${this.appConfig.apiVersion}`,
      status: 'operational',
    };
  }
}
