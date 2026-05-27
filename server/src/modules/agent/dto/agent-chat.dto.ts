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

  /** 草稿级 agent 实例标识：用于共享 agent 记忆/tasks；sessionKey 只表示当前业务聊天。 */
  @IsString()
  @IsOptional()
  agentInstanceKey?: string;
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
