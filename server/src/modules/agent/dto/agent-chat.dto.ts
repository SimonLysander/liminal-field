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
}

/**
 * AnchorDto — 前端编辑器锚点的后端验证对象。
 * 对应前端 AnchorPayload，序列化了 selection/cursor 位置供 prompt.handler 注入定位节。
 */
class AnchorDto {
  @IsString()
  @IsIn(['none', 'cursor', 'range'])
  type!: 'none' | 'cursor' | 'range';

  @IsOptional()
  @IsNumber()
  blockIndex?: number;

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  startPath?: number[];

  @IsOptional()
  @IsArray()
  @IsNumber({}, { each: true })
  endPath?: number[];

  @IsOptional()
  @IsString()
  textPreview?: string;
}

class EntryContextDto {
  // notes-editor = 编辑器侧栏写作顾问;agent-page = 全页总助手 Lux
  @IsIn(['notes-editor', 'agent-page'])
  source!: string;

  @ValidateNested()
  @Type(() => DocumentContextDto)
  @IsOptional()
  document?: DocumentContextDto;

  @IsString()
  @IsOptional()
  selectedText?: string;

  /** 会话标识，task 工具需要知道写入哪个 session */
  @IsString()
  @IsOptional()
  sessionKey?: string;

  /**
   * v2 改稿锚点：编辑器当前 selection/cursor 序列化结果。
   * 后端 prompt.handler 据此注入 <selection>/<cursor> 节，Aurora 据此选改稿工具。
   */
  @IsOptional()
  @ValidateNested()
  @Type(() => AnchorDto)
  anchor?: AnchorDto;
}

export class AgentChatDto {
  /** AI SDK 发送的 messages 数组，直接透传给 streamText，不做深层校验 */
  @Allow()
  messages!: any[];

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
