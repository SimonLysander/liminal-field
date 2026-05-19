import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * 添加/编辑文集条目的请求 DTO。
 *
 * - title: 条目标题（必须）
 * - date: ISO 8601 日期字符串（可选，如 "2026-05-01"）
 * - bodyMarkdown: 条目正文（必须，不含 frontmatter，后端负责序列化为带 frontmatter 的完整文件）
 * - changeNote: 变更说明（可选，记录在 ContentSnapshot.changeNote 中）
 */
export class SaveAnthologyEntryDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  date?: string;

  @IsString()
  bodyMarkdown: string;

  @IsString()
  @IsOptional()
  changeNote?: string;
}

/**
 * 重排条目顺序的请求 DTO。
 * newOrder 是条目 key 的新顺序，必须和现有条目集合完全一致（长度、元素）。
 *
 * 注意：必须加 @IsArray() + @IsString({each: true}) 装饰器，
 * 否则 ValidationPipe(whitelist: true) 会将未装饰的字段剥掉，导致 newOrder 为 undefined。
 */
export class ReorderAnthologyEntriesDto {
  /** 新顺序的条目 key 列表，如 ["e002", "e001", "e003"]。 */
  @IsArray()
  @IsString({ each: true })
  newOrder: string[];
}
