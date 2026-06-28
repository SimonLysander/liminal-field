import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/**
 * 批量探针入参:一组 contentItemId，问「哪些有非空 AI 初稿」。
 * 学习页判 studied 用——替掉前端逐篇 getAiDraft 的重复请求。
 * 上限 500，防一次塞过多 id 打爆 $in 查询。
 */
export class AidraftExistsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(500)
  contentItemIds!: string[];
}
