import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import type { AdminAssetCountsResponse, AdminLibraryStatsResponse } from '@photox/shared-types';
import { AdminAssetsService } from './admin-assets.service';
import {
  AdminAssetCountsResponseModel,
  AdminLibraryStatsResponseModel,
} from '../swagger/response-models';

@ApiTags('admin')
@Controller('api/v1/admin/assets')
export class AdminAssetsController {
  constructor(private readonly admin: AdminAssetsService) {}

  @Get('counts')
  @ApiOperation({ summary: 'Asset failure counters grouped by kind (admin-only)' })
  @ApiResponse({
    status: 200,
    description: 'Failure counters',
    type: AdminAssetCountsResponseModel,
  })
  async counts(): Promise<AdminAssetCountsResponse> {
    return this.admin.getFailureCounts();
  }

  @Get('stats')
  @ApiOperation({ summary: 'Library-wide counts, weekly uploads and monthly storage (admin-only)' })
  @ApiResponse({ status: 200, description: 'Library stats', type: AdminLibraryStatsResponseModel })
  async stats(): Promise<AdminLibraryStatsResponse> {
    return this.admin.getLibraryStats();
  }
}
