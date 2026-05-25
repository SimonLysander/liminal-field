/**
 * applyProposedEdits 单测
 *
 * 覆盖范围：
 *   - 失败路径（不依赖真实 Plate 库）：not-found / not-unique / 多处部分失败的 outcomes 等长对应
 *   - 成功路径：通过 vi.mock 桩掉 deserializeMd + diffToSuggestions，验证 tf 被调用、outcome.ok=true
 *
 * 成功路径依赖 vi.mock 在模块初始化时替换 @platejs/markdown / @platejs/suggestion，
 * 这要求 mock 声明在 import 之前（vitest hoisting 机制自动提升）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Descendant } from 'platejs';

// ── 成功路径需要的模块 mock（hoisting 确保在 import 前生效）──────────────────
// 注：vi.mock 调用会被 vitest 自动提升到文件顶部，早于任何 import 执行
vi.mock('@platejs/markdown', () => ({
  deserializeMd: vi.fn(() => [{ type: 'p', children: [{ text: '新文本' }] }]),
}));

vi.mock('@platejs/suggestion', () => ({
  diffToSuggestions: vi.fn(() => [{ type: 'p', children: [{ text: '新文本(suggestion)' }] }]),
}));

// ── 被测模块（在 mock 生效后再 import）────────────────────────────────────────
import { applyProposedEdits } from './apply-proposed-edits';
import type { ProposedEdit } from './apply-proposed-edits';

// ── 工具函数：构造最小化 mock editor ──────────────────────────────────────────

/** 构造失败路径用的 editor（无需 tf，findBlockByText 失败时不会调用 tf） */
function makeLightEditor(children: Descendant[]) {
  return { children } as any;
}

/** 构造成功路径用的 editor（带 tf.removeNodes + tf.insertNodes） */
function makeFullEditor(children: Descendant[]) {
  return {
    children,
    tf: {
      removeNodes: vi.fn(),
      insertNodes: vi.fn(),
    },
    // deserializeMd 第一参数是 editor，mock 不关心其内容，传空对象兜底
  } as any;
}

// ── 公共文档节点 ───────────────────────────────────────────────────────────────
const singleBlock = [
  { type: 'p', children: [{ text: '第一段讲背景。' }] },
] as unknown as Descendant[];

const twoBlocks = [
  { type: 'p', children: [{ text: '第一段讲背景。' }] },
  { type: 'p', children: [{ text: '第二段讲方法。' }] },
] as unknown as Descendant[];

const dupBlocks = [
  { type: 'p', children: [{ text: '重复句。第一个块。' }] },
  { type: 'p', children: [{ text: '重复句。第二个块。' }] },
] as unknown as Descendant[];

// ── 失败路径测试 ───────────────────────────────────────────────────────────────
describe('applyProposedEdits — 失败路径', () => {
  it('find 找不到时：outcomes[0].ok === false, reason === not-found', () => {
    const editor = makeLightEditor(singleBlock);
    const edits: ProposedEdit[] = [
      { find: '这段话不存在', replace: '替换文本', reason: '测试' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    if (!outcomes[0].ok) {
      expect(outcomes[0].reason).toBe('not-found');
    }
  });

  it('find 在多个块命中时：reason === not-unique', () => {
    const editor = makeLightEditor(dupBlocks);
    const edits: ProposedEdit[] = [
      { find: '重复句', replace: '新内容', reason: '测试' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(false);
    if (!outcomes[0].ok) {
      expect(outcomes[0].reason).toBe('not-unique');
    }
  });

  it('单块内 find 出现两次：reason === not-unique', () => {
    const twiceBlock = [
      { type: 'p', children: [{ text: 'ab 在这 ab 重复了' }] },
    ] as unknown as Descendant[];
    const editor = makeLightEditor(twiceBlock);
    const edits: ProposedEdit[] = [
      { find: 'ab', replace: 'cd', reason: '测试' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes[0].ok).toBe(false);
    if (!outcomes[0].ok) {
      expect(outcomes[0].reason).toBe('not-unique');
    }
  });

  it('多处 edits 部分失败：outcomes 长度等于 edits 长度，对应项各自标注状态', () => {
    // 两块可命中第一个 find，第二个 find 不存在
    const editor = makeLightEditor(twoBlocks);
    const edits: ProposedEdit[] = [
      { find: '不存在的片段', replace: '无所谓', reason: '第一处失败' },
      { find: '也不存在的片段', replace: '无所谓', reason: '第二处失败' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    // outcomes 必须与 edits 等长（失败项 ok=false 而非跳过）
    expect(outcomes).toHaveLength(edits.length);
    expect(outcomes[0].ok).toBe(false);
    expect(outcomes[1].ok).toBe(false);
  });

  it('混合场景：第一处找不到、第二处无需 tf（不影响 outcomes 长度）', () => {
    // twoBlocks 里 '第一段讲背景' 可命中，但为了隔离成功路径，
    // 此用例只验证"全失败时长度等长"，不触发 tf
    const editor = makeLightEditor(twoBlocks);
    const edits: ProposedEdit[] = [
      { find: '不存在A', replace: 'x', reason: '失败1' },
      { find: '不存在B', replace: 'y', reason: '失败2' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes).toHaveLength(2);
    outcomes.forEach((o) => expect(o.ok).toBe(false));
  });
});

// ── 成功路径测试 ───────────────────────────────────────────────────────────────
describe('applyProposedEdits — 成功路径（依赖 vi.mock）', () => {
  let removeNodes: ReturnType<typeof vi.fn>;
  let insertNodes: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('find 命中时：outcome.ok=true，removeNodes 与 insertNodes 各被调用一次', () => {
    const editor = makeFullEditor(singleBlock);
    removeNodes = editor.tf.removeNodes;
    insertNodes = editor.tf.insertNodes;

    const edits: ProposedEdit[] = [
      { find: '第一段讲背景', replace: '修改后的内容', reason: '改背景描述' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].ok).toBe(true);
    if (outcomes[0].ok) {
      expect(outcomes[0].blockIndex).toBe(0);
    }

    // 旧块被移除、新 suggestion 节点被插入
    expect(removeNodes).toHaveBeenCalledOnce();
    expect(insertNodes).toHaveBeenCalledOnce();
  });

  it('多处 edits 全部命中：每处 outcome.ok=true，tf 各调用对应次数', () => {
    const editor = makeFullEditor(twoBlocks);
    removeNodes = editor.tf.removeNodes;
    insertNodes = editor.tf.insertNodes;

    const edits: ProposedEdit[] = [
      { find: '第一段讲背景', replace: '新背景', reason: '改背景' },
      { find: '第二段讲方法', replace: '新方法', reason: '改方法' },
    ];
    const outcomes = applyProposedEdits(editor, edits);

    expect(outcomes).toHaveLength(2);
    outcomes.forEach((o) => expect(o.ok).toBe(true));

    // 两处 edit，每处各调用一次 remove + insert
    expect(removeNodes).toHaveBeenCalledTimes(2);
    expect(insertNodes).toHaveBeenCalledTimes(2);
  });
});
