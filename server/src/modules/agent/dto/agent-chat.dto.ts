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

  /** 文集场景:前端拼好的整集脉络(标题/描述+条目列表+当前位置)。笔记无此字段。 */
  @IsString()
  @IsOptional()
  collectionContext?: string;
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

class EntryContextDto {
  // notes-editor = 编辑器侧栏写作顾问;agent-page = 全页总助手 Lux;gallery-editor = 画廊图说写手
  @IsIn(['notes-editor', 'agent-page', 'gallery-editor'])
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

  /** 前端传入的相关召回记忆，注入 system prompt */
  @Allow()
  relatedMemories?: Array<{
    key: string;
    type: string;
    title: string;
    content: string;
  }>;

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
