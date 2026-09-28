import { describe, expect, it } from 'vitest';
import { buildLearningContext } from '../learning-context';
import type { Chapter } from '../useLearningData';

function chapter(title: string, independent = false, depth = 0): Chapter {
  return {
    title, depth, navId: `nav-${title}`, contentItemId: `ci-${title}`,
    studied: false, isIndependentLearningRoot: independent,
  };
}

const topic = { isTopic: true, contentItemId: 'ci-topic', title: '投资方法' };
const data = {
  topicTitle: '投资方法', topicContentItemId: 'ci-topic', plan: null,
  allChapters: [
    chapter('基本面投资'), chapter('主题投资'), chapter('趋势投资'), chapter('量化交易', true),
  ],
};

describe('buildLearningContext', () => {
  it('keeps all four chapter entries when the fourth owns an independent learning project', () => {
    const context = buildLearningContext(data, topic);
    expect(context).toContain('共 4 个节点');
    for (const item of data.allChapters) {
      expect(context).toContain(`《${item.title}》(ID:${item.contentItemId})`);
    }
    expect(context).toContain('量化交易》(ID:ci-量化交易) 独立学习');
    expect(context).toContain('未查询研究进度');
    expect(context).not.toContain('量化交易》(ID:ci-量化交易) 尚无 AI 初稿');
    expect(context).toContain('其学习进度和初稿写入由自身学习管理');
  });

  it('does not report an empty directory when all children have independent learning projects', () => {
    const context = buildLearningContext({ ...data, allChapters: [chapter('量化交易', true)] }, topic);
    expect(context).toContain('共 1 个节点');
    expect(context).not.toContain('还没建');
  });

  it('preserves depth, the current content ID, plan overview and owned research state', () => {
    const context = buildLearningContext({
      ...data,
      plan: { goal: '理解投资决策', understanding: '', conclusion: '', items: [] },
      allChapters: [chapter('基本面投资'), { ...chapter('估值', false, 1), studied: true }],
    }, { isTopic: false, contentItemId: 'ci-估值', title: '估值' });
    expect(context).toContain('在写 《估值》(ID:ci-估值),所属 《投资方法》(ID:ci-topic)(概要:理解投资决策)');
    expect(context).toContain('2.   《估值》(ID:ci-估值) 已研究 ←当前');
    expect(context).not.toContain('独立学习');
  });

  it('reports an empty directory only when it actually has no entries', () => {
    expect(buildLearningContext({ ...data, allChapters: [] }, topic)).toContain('还没建');
  });
});
