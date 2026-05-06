import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Public } from '../auth/decorators/public.decorator';
import { ContentVisibility } from '../content/dto/content-query.dto';
import { CreateStructureNodeDto } from './dto/create-structure-node.dto';
import { ReorderSiblingsDto } from './dto/reorder-siblings.dto';
import {
  StructureNodeDto,
  StructureListResultDto,
  DeleteStatsDto,
} from './dto/structure-node.dto';
import { NavigationNodeService } from './navigation.service';
import { UpdateStructureNodeDto } from './dto/update-structure-node.dto';

@Controller()
export class NavigationNodeController {
  constructor(private readonly navigationNodeService: NavigationNodeService) {}

  @Post('structure-nodes')
  async createStructureNode(
    @Body() createStructureNodeDto: CreateStructureNodeDto,
  ): Promise<StructureNodeDto> {
    return this.navigationNodeService.createStructureNode(
      createStructureNodeDto,
    );
  }

  @Put('structure-nodes/:id')
  async updateStructureNode(
    @Param('id') id: string,
    @Body() updateStructureNodeDto: UpdateStructureNodeDto,
  ): Promise<StructureNodeDto> {
    return this.navigationNodeService.updateStructureNode(
      id,
      updateStructureNodeDto,
    );
  }

  @Post('structure-nodes/reorder')
  async reorderSiblings(@Body() dto: ReorderSiblingsDto): Promise<void> {
    return this.navigationNodeService.reorderSiblings(dto);
  }

  @Public()
  @Get('structure-nodes')
  async listStructureNodes(
    @Query('parentId') parentId: string | undefined,
    @Query('visibility') visibility: ContentVisibility | undefined,
    @Query('scope') scope: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<StructureListResultDto> {
    // 未登录用户强制只查看已发布内容
    if (!request.user) {
      visibility = ContentVisibility.public;
    }
    return this.navigationNodeService.listStructureNodes(
      parentId,
      visibility,
      scope,
    );
  }

  @Get('structure-nodes/:id/delete-stats')
  async getDeleteStats(@Param('id') id: string): Promise<DeleteStatsDto> {
    return this.navigationNodeService.getDeleteStats(id);
  }

  @Delete('structure-nodes/:id')
  async deleteStructureNode(@Param('id') id: string): Promise<void> {
    return this.navigationNodeService.deleteNavigationNodeById(id);
  }

  @Public()
  @Get('structure-nodes/:id/path')
  async getStructurePathByNodeId(
    @Param('id') id: string,
  ): Promise<StructureNodeDto[]> {
    return this.navigationNodeService.findStructurePathByNodeId(id);
  }

  // Keep content-to-structure path as a derived resource so clients can load
  // breadcrumbs directly instead of first resolving the structure node id.
  @Public()
  @Get('contents/:contentItemId/structure-path')
  async getStructurePathByContentItemId(
    @Param('contentItemId') contentItemId: string,
  ): Promise<StructureNodeDto[]> {
    return this.navigationNodeService.findStructurePathByContentItemId(
      contentItemId,
    );
  }
}
