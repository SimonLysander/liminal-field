/**
 * DigestPublicController — digest 公开读取端点（无鉴权）。
 *
 * 路径前缀: @Controller('digest')（拼到 /api/v1/digest/*）
 * 权限: 所有端点标注 @Public()，JwtAuthGuard 跳过强制鉴权。
 *
 * 端点:
 *   GET /digest/topics/:topicId                      → PublicTopicDto
 *   GET /digest/topics/:topicId/reports/:reportId    → PublicReportDto
 *
 * 注意：TopicController 已占 GET /digest/topics/:id（admin 用）。
 * 为避免路由冲突，两个 controller 各自有不同 @Get path，路由引擎按注册顺序匹配。
 * 本 controller 的 GET /digest/topics/:topicId 与 TopicController 的 GET /digest/topics/:id
 * 路径相同，但因为本 controller 使用 @Public() 而 TopicController 需要 JWT，
 * NestJS 路由是路径匹配的——不会因装饰器不同而区分。
 * ⚠️ 解决方案：公开 getTopic 端点路径改为 /digest/public/topics/:topicId，
 * 避免覆盖 admin 的 GET /digest/topics/:id。
 * getReport 端点路径 /digest/topics/:topicId/reports/:reportId 是全新路径，无冲突。
 */
import { Controller, Get, Logger, Param } from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import { DigestPublicService } from './digest-public.service';
import type { PublicReportDto, PublicTopicDto } from './dto/digest-public.dto';

@Controller('digest')
export class DigestPublicController {
  private readonly logger = new Logger(DigestPublicController.name);

  constructor(private readonly digestPublicService: DigestPublicService) {}

  /**
   * 列出所有公开 digest 事项，供 /digest 目录页使用。
   * 路径 /digest/public/topics 无法与 admin /digest/topics 冲突（prefix 不同）。
   */
  @Public()
  @Get('public/topics')
  async listTopics(): Promise<PublicTopicDto[]> {
    this.logger.debug('GET /digest/public/topics');
    return this.digestPublicService.listTopics();
  }

  /**
   * 读事项 + 报告列表，供 /digest/:topicId 专栏首页使用。
   * 路径用 /digest/public/topics/:topicId 避免与 admin TopicController
   * 的 GET /digest/topics/:id 产生路由冲突。
   */
  @Public()
  @Get('public/topics/:topicId')
  async getTopic(@Param('topicId') topicId: string): Promise<PublicTopicDto> {
    this.logger.debug(`GET /digest/public/topics/${topicId}`);
    return this.digestPublicService.getTopic(topicId);
  }

  /**
   * 读单个报告，供 /digest/:topicId/:reportId 报告页使用。
   * 此路径是全新的，admin controller 无此路径，无冲突。
   */
  @Public()
  @Get('topics/:topicId/reports/:reportId')
  async getReport(
    @Param('topicId') topicId: string,
    @Param('reportId') reportId: string,
  ): Promise<PublicReportDto> {
    this.logger.debug(`GET /digest/topics/${topicId}/reports/${reportId}`);
    return this.digestPublicService.getReport(topicId, reportId);
  }
}
