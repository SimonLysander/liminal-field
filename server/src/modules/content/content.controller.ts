/**
 * ContentController — 保留跨 scope 的公共端点。
 *
 * CRUD 路由已迁移至 WorkspaceController（/spaces/:scope/items/...），
 * 此处仅保留全局搜索和首页聚合——它们不属于任何单一 scope。
 */
import { Controller, Get, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { ContentService } from './content.service';
import { ContentListItemDto } from './dto/content-list-item.dto';
import { ContentQueryDto, ContentVisibility } from './dto/content-query.dto';

@Controller()
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Public()
  @Get('search')
  async searchContents(
    @Query() query: ContentQueryDto,
    @Req() request: FastifyRequest,
  ): Promise<ContentListItemDto[]> {
    // 未登录用户强制只搜索已发布内容
    if (!request.user) {
      query.visibility = ContentVisibility.public;
    }
    return this.contentService.searchContents(query);
  }

  /** 首页聚合：hero + featured + latest（原 HomeModule 收入此处）。 */
  @Public()
  @Get('home')
  async getHome() {
    return this.contentService.getHome();
  }
}
