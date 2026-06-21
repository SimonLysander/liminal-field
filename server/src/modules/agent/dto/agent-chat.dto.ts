/**
 * AgentChatDto — Agent 对话请求的入参验证。
 *
 * Vercel AI SDK 的 useChat() 发送的格式包含额外字段（id, trigger, parts 等），
 * 全局 ValidationPipe 的 whitelist+forbidNonWhitelisted 会拒绝这些字段。
 *
 * 解决方案：只校验我们自定义的字段（entryContext, tier），
 * messages 和 AI SDK 自带字段不做严格校验，直接透传给 streamText。
 */
import { Type } from 'class-transformer';
import {
  Allow,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class DocumentContextDto {
  @IsString()
  contentItemId!: string;

  @IsString()
  title!: string;

  @IsString()
  bodyMarkdown!: string;

  // #150 续(2026-05-31):collectionContext 已从前端 push 改为后端 pull
  // (AgentLifecycle.onBeforeChat 按 contentItemId 自己查),不再走 DTO。
}

/** 画廊单张照片的文字信息(不含图像字节;图由后端 prepareStep 按需注入)。 */
class GalleryPhotoDto {
  @IsNumber()
  index!: number;

  @IsString()
  fileName!: string;

  @IsString()
  caption!: string;

  // tags 是 Record<string,string>(EXIF 等),不深校验,直接透传
  @Allow()
  tags!: Record<string, string>;
}

/** 画廊场景上下文:随笔 + 照片清单。图说写手用,内容靠 get_current_draft read。 */
class GalleryContextDto {
  @IsString()
  contentItemId!: string;

  @IsString()
  title!: string;

  @IsString()
  prose!: string;

  // 照片清单必随 gallery 一同给(可空数组,但不缺字段)——下游 GalleryContext.photos 为必填
  @ValidateNested({ each: true })
  @Type(() => GalleryPhotoDto)
  photos!: GalleryPhotoDto[];
}

/** 精选报告 finding 索引项(citationId/title/source);供 sub-agent 答用户追问。 */
class DigestReportFindingDto {
  @IsNumber()
  citationId!: number;

  @IsString()
  title!: string;

  @IsString()
  sourceName!: string;

  @IsString()
  url!: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  snippet?: string;
}

/**
 * 简报阅读页场景上下文:全篇注入 — 报告完整 markdown + findings 完整字段。
 * 选区追问不走这里——用户划词后点"追问 Aurora"是走 selectionAttachments(chip 机制),
 * 跟编辑器"添加到聊天"同一套,chip 发送瞬间拼成 markdown 引用块进 user text。
 */
class DigestReportContextDto {
  @IsString()
  reportId!: string;

  @IsString()
  topicId!: string;

  @IsString()
  topicName!: string;

  @IsString()
  topicPrompt!: string;

  @IsString()
  headline!: string;

  @IsString()
  publishedAt!: string;

  /** 报告正文 markdown 完整全文(~4500 字),sub-agent 直接读原文不走工具 */
  @IsString()
  markdown!: string;

  @IsArray()
  @IsString({ each: true })
  sections!: string[];

  @ValidateNested({ each: true })
  @Type(() => DigestReportFindingDto)
  findings!: DigestReportFindingDto[];
}

class EntryContextDto {
  // notes-editor = 编辑器侧栏写作顾问;agent-page = 全页总助手 Lux;gallery-editor = 画廊图说写手;report-reader = 公开端精选阅读页追问
  @IsIn(['notes-editor', 'agent-page', 'gallery-editor', 'report-reader'])
  source!: string;

  @ValidateNested()
  @Type(() => DocumentContextDto)
  @IsOptional()
  document?: DocumentContextDto;

  /** 画廊场景:照片清单+随笔。传了即走图说写手链路。 */
  @ValidateNested()
  @Type(() => GalleryContextDto)
  @IsOptional()
  gallery?: GalleryContextDto;

  /** 精选阅读页:报告元数据 + findings 索引 + 可选用户划词。传了即注入 <digest_report>。 */
  @ValidateNested()
  @Type(() => DigestReportContextDto)
  @IsOptional()
  digestReport?: DigestReportContextDto;

  @IsString()
  @IsOptional()
  selectedText?: string;

  /** 会话标识，task 工具需要知道写入哪个 session */
  @IsString()
  @IsOptional()
  sessionKey?: string;

  /** 草稿级 agent 实例标识：用于共享 agent 记忆/tasks；sessionKey 只表示当前业务聊天。 */
  @IsString()
  @IsOptional()
  agentInstanceKey?: string;
}

export class AgentChatDto {
  /** prepareSendMessagesRequest 只发的最新一条 UIMessage;历史由后端从 agent_sessions 读。 */
  @Allow()
  message?: any;

  @ValidateNested()
  @Type(() => EntryContextDto)
  entryContext!: EntryContextDto;

  @IsIn(['flash', 'standard', 'think'])
  @IsOptional()
  tier?: 'flash' | 'standard' | 'think';

  /** agent 入口标识，如 "writing-advisor"，用于加载对应 AgentEntryConfig */
  @IsString()
  @IsOptional()
  agentKey?: string;

  /** AI SDK 自带字段，允许通过但不使用 */
  @Allow()
  id?: string;

  @Allow()
  trigger?: string;
}
