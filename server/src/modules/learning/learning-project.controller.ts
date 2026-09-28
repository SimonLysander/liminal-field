import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CreateLearningProjectDto } from './dto/create-learning-project.dto';
import type {
  LearningProjectDiscardDto,
  LearningProjectDto,
  LearningProjectResolveDto,
  LearningProjectOutlineDto,
} from './dto/learning-project.dto';
import { LearningProjectService } from './learning-project.service';

@Controller('learning/projects')
export class LearningProjectController {
  constructor(private readonly service: LearningProjectService) {}

  @Get('resolve')
  resolve(@Query('nodeId') nodeId: string): Promise<LearningProjectResolveDto> {
    return this.service.resolveByNodeId(nodeId);
  }

  @Get('outline')
  outline(@Query('nodeId') nodeId: string): Promise<LearningProjectOutlineDto> {
    return this.service.getOutline(nodeId);
  }

  @Post()
  create(@Body() dto: CreateLearningProjectDto): Promise<LearningProjectDto> {
    return this.service.startProject(dto.rootNodeId);
  }

  @Post(':id/discard')
  discard(@Param('id') id: string): Promise<LearningProjectDiscardDto> {
    return this.service.discardProject(id);
  }
}
