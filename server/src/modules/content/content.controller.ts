/**
 * ContentController — 保留跨 scope 的公共端点。
 *
 * CRUD 路由已迁移至 WorkspaceController（/spaces/:scope/items/...），
 * 此处仅保留全局搜索——它不属于任何单一 scope。
 * 首页聚合端点已迁移至 HomeController（/home），由 HomeModule 统一编排。
 */
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { ContentService } from './content.service';
import { SearchResultDto } from './dto/search-result.dto';
import { ContentQueryDto, ContentVisibility } from './dto/content-query.dto';

@Controller()
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  /** 全局搜索，返回带 scope 和 snippet 的结果 */
  @Public()
  @Get('search')
  async searchContents(
    @Query() query: ContentQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<SearchResultDto[]> {
    if (!request.user) {
      query.visibility = ContentVisibility.public;
    }
    return this.contentService.searchWithScope(query);
  }
}
