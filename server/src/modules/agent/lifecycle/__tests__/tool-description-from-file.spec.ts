/**
 * 提示词集中管理 — 工具 description 走集中表(tools/tool-descriptions.ts)。
 *
 * Test A:TOOL_DESCRIPTIONS 表完整、每条非空、无占位残留。
 * Test B:tool.assembler 组装收尾按工具名用表里描述覆盖工厂占位(端到端,证明 override 生效)。
 */
import { ToolAssembler } from '../tool.assembler';
import { TOOL_DESCRIPTIONS } from '../../../../prompts/tool-descriptions';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const CITATION_BUCKETS = [
  '概念与定义',
  '归属与演进',
  '数据与状态',
  '规则与证据',
];

describe('工具 description 集中表', () => {
  it('至少 20 条、每条非空且无占位残留', () => {
    const keys = Object.keys(TOOL_DESCRIPTIONS);
    expect(keys.length).toBeGreaterThanOrEqual(20);
    for (const k of keys) {
      const v = TOOL_DESCRIPTIONS[k];
      expect(v.trim().length).toBeGreaterThan(15);
      expect(v).not.toContain('描述见'); // 防止把占位指针误写进表
    }
  });

  it('browse 的词边界反斜杠正确保留(运行时为 \\bword\\b 字面量)', () => {
    expect(TOOL_DESCRIPTIONS.browse).toContain('\\bword\\b');
  });

  it('write_draft 出处规则用内容类型桶表达', () => {
    for (const bucket of CITATION_BUCKETS) {
      expect(TOOL_DESCRIPTIONS.write_draft).toContain(bucket);
    }
    expect(TOOL_DESCRIPTIONS.write_draft).not.toContain(
      '凡能被外部来源证实或推翻',
    );
    expect(TOOL_DESCRIPTIONS.write_draft).not.toContain('基础专业概念首次定义');
    expect(TOOL_DESCRIPTIONS.write_draft).not.toContain('常识不豁免专业定义');
    expect(TOOL_DESCRIPTIONS.write_draft).toContain('主线依赖');
    expect(TOOL_DESCRIPTIONS.write_draft).toContain('不逐条追深奥细节');
    expect(TOOL_DESCRIPTIONS.write_draft).toContain('citationAudit');
  });

  it('web_fetch description 只描述读取能力和失败事实,不指挥下一步动作', () => {
    expect(TOOL_DESCRIPTIONS.web_fetch).toContain('Firecrawl');
    expect(TOOL_DESCRIPTIONS.web_fetch).toContain('Jina');
    expect(TOOL_DESCRIPTIONS.web_fetch).toContain('attempts');
    expect(TOOL_DESCRIPTIONS.web_fetch).not.toContain('web_search 摘要兜底');
    expect(TOOL_DESCRIPTIONS.web_fetch).not.toContain('应换来源');
    expect(TOOL_DESCRIPTIONS.web_fetch).not.toContain('连续重试');
  });
});

describe('学习成稿 skill 提示词', () => {
  it('出处规则用内容类型桶表达', () => {
    const body = readFileSync(
      resolve(__dirname, '../../../../prompts/skills/note-writing.md'),
      'utf8',
    );
    for (const bucket of CITATION_BUCKETS) {
      expect(body).toContain(bucket);
    }
    expect(body).not.toContain('凡正文落到可证伪的事实');
    expect(body).not.toContain('这句能被一个外部来源证实或推翻吗');
    expect(body).not.toContain('基础专业概念首次定义');
    expect(body).not.toContain('常识不豁免专业定义');
    expect(body).toContain('主线依赖');
    expect(body).toContain('不逐条追深奥细节');
    expect(body).toContain('citationAudit');
  });
});

describe('工具 description 集中表 — assemble 覆盖', () => {
  it('assemble 后 write_draft.description 来自表、非工厂占位', () => {
    // ToolAssembler 共 16 个注入依赖;本测试只验 description 覆盖,工具工厂仅闭包捕获依赖、
    // 组装期不调用其方法,故全部传 null（cast 绕过 arity）。
    const nulls = Array.from({ length: 16 }, () => null);
    const Assembler = ToolAssembler as unknown as new (
      ...args: unknown[]
    ) => ToolAssembler;
    const assembler = new Assembler(...nulls);

    const tools = assembler.assemble({
      learningNoteId: 'n1',
      sessionKey: 's1',
    }) as Record<string, { description: string }>;

    expect(tools.write_draft.description).toBe(TOOL_DESCRIPTIONS.write_draft);
    expect(tools.write_draft.description).not.toContain('描述见');
  });
});
