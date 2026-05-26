import { Logger } from '@nestjs/common';
import { tool, jsonSchema } from 'ai';
import { toolResult } from './tool-result';

// 模块级 logger，与 NestJS 日志体系统一，便于按 LOG_LEVEL 控制详细度
const logger = new Logger('ProposeEditTool');

/**
 * propose_edit —— 向当前草稿提出【多处】修改(查找-替换块)。
 *
 * 纯管道工具:本工具【不碰正文、不验证 find 是否命中】。正文真相在前端编辑器
 * (草稿 local-first),后端只有上次同步的旧 bodyMarkdown,无权定位。AI 的 edits
 * 入参经 AI SDK 透传到前端 message 的 tool-propose_edit part,由前端块级定位并落成
 * suggestion 痕迹。execute 只做结构校验 + 回报处数给模型。
 */
const MAX_FIND = 4000; // 单个 find 片段上限,挡住模型整篇塞进来

export function createProposeEditTool() {
  return tool({
    description:
      '向当前草稿提出修改。每处给出 find(从当前正文一字不差摘录、且在文中唯一的原文片段)、replace(改成的新文本)、reason(为什么改)。一次调用可提多处,修改以行内增删痕迹出现在编辑器里供用户逐处裁决——你只负责提议,不假设已被采纳。\n\n【find 必须遵守的规则】(违反就会"没在正文里定位到"失败):\n1. 单块原则:find 必须完整落在一个段落 / 一个标题 / 一个列表项里,绝不跨块。要改多个块就拆成多次 edits 项。\n2. 不带 markdown 标记:正文里看到的 "# 标题"、"- 列表" 等前缀只是显示语法,find 摘抄时去掉前缀的 "# "、"- "、"> ",只抄纯文本。\n3. 不带换行符:find 里不要出现 \\n,一行一处。\n4. 拿不准就少改、分多轮;宁可一次一处,也别一次塞个跨块大段拼接。',
    inputSchema: jsonSchema<{
      edits: Array<{ find: string; replace: string; reason: string }>;
    }>({
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: '一处或多处修改',
          items: {
            type: 'object',
            properties: {
              find: {
                type: 'string',
                description:
                  '从当前正文一字不差摘录、单块内、不带 markdown 标记(# / - / > 等)、不含换行的纯文本片段',
              },
              replace: { type: 'string', description: '改成的新文本' },
              reason: {
                type: 'string',
                description: '这处为什么改(显示给用户)',
              },
            },
            required: ['find', 'replace', 'reason'],
          },
        },
      },
      required: ['edits'],
    }),
    execute: ({
      edits,
    }: {
      edits: Array<{ find: string; replace: string; reason: string }>;
    }) => {
      // 入参摘要日志：只记长度，不记 find/replace 正文（CLAUDE.md 日志准则：禁止记正文全文）
      logger.debug(
        `propose_edit 收到 ${edits?.length ?? 0} 处, find长度=[${(edits ?? []).map((e) => e?.find?.length ?? 0).join(',')}]`,
      );

      // 防御:模型可能传出非数组结构(单对象/null),先挡住再过滤,避免 filter 抛错
      if (!Array.isArray(edits)) {
        return toolResult('没有有效的修改项', undefined, {
          status: 'invalid',
          count: 0,
        });
      }
      const valid = edits.filter(
        (e) =>
          typeof e?.find === 'string' &&
          e.find.trim().length > 0 &&
          e.find.length <= MAX_FIND &&
          typeof e?.replace === 'string' &&
          e.replace.length > 0,
      );

      // 校验后有效处数（过滤掉空字符串、超长、非字符串的入参）
      logger.debug(`有效 ${valid.length} 处`);

      if (valid.length === 0) {
        return toolResult('没有有效的修改项', undefined, {
          status: 'invalid',
          count: 0,
        });
      }
      return toolResult(
        `已向草稿提议 ${valid.length} 处修改,待用户在编辑器中确认`,
        undefined,
        {
          status: 'ok',
          count: valid.length,
        },
      );
    },
  });
}
