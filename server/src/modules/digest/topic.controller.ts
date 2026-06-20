/**
 * TopicController — 智能采集事项 CRUD REST API。
 *
 * 路径前缀: /digest/topics（事项是 digest 独占，归在 /digest 下）
 * 权限: 默认全局 JwtAuthGuard，无 @Public()
 *
 * 端点:
 *   GET    /digest/topics        list
 *   GET    /digest/topics/:id    get (404 不存在)
 *   POST   /digest/topics        create (400 cron 格式 / 400 sourceIds 不存在)
 *   PATCH  /digest/topics/:id    update (404 不存在 / 400 格式错误)
 *   DELETE /digest/topics/:id    delete (404 不存在)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { TopicService } from './topic.service';
import { CreateTopicDto } from './dto/smart-topic-config.dto';
import { UpdateTopicDto } from './dto/update-topic.dto';

@Controller('digest/topics')
export class TopicController {
  private readonly logger = new Logger(TopicController.name);

  constructor(private readonly topicService: TopicService) {}

  @Get()
  list() {
    return this.topicService.list();
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.topicService.getById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateTopicDto & { description?: string }) {
    this.logger.debug(`POST /digest/topics name=${dto.name}`);
    return this.topicService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTopicDto) {
    this.logger.debug(`PATCH /digest/topics/${id}`);
    return this.topicService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    this.logger.debug(`DELETE /digest/topics/${id}`);
    await this.topicService.delete(id);
  }
}
