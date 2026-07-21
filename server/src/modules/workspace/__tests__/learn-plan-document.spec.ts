import {
  parseLearnPlanDocument,
  serializeLearnPlanDocument,
} from '../learn-plan-document';

const document = {
  goal: '理解光如何成为画面',
  understanding:
    '摄影首先是记录光的过程。\n\n学习它，是为了把偶然拍到变成主动选择。\n\n这份笔记将沿成像、曝光与表达逐步展开。',
  items: [
    {
      title: '成像基础',
      thread: '物理起点',
      why: '先理解光如何形成图像。',
    },
  ],
  conclusion:
    '由成像走向表达，参数最终应成为判断工具。\n\n每一次快门都应有清楚的选择。',
};

describe('learn-plan-document', () => {
  it('序列化后可完整解析多段开篇、篇目和多段收束', () => {
    expect(
      parseLearnPlanDocument(serializeLearnPlanDocument(document)),
    ).toEqual(document);
  });

  it('旧规划缺少 conclusion 时返回空字符串', () => {
    expect(
      parseLearnPlanDocument(`---
goal: 旧规划
items:
  - title: 基础
    thread: 起点
    why: 建立基础
---

旧的理解正文。`),
    ).toEqual({
      goal: '旧规划',
      understanding: '旧的理解正文。',
      items: [{ title: '基础', thread: '起点', why: '建立基础' }],
      conclusion: '',
    });
  });

  it('损坏的规划格式抛出错误，不与“没有规划”混为一谈', () => {
    expect(() =>
      parseLearnPlanDocument(`---
goal: 损坏的规划
items: not-an-array
---

正文。`),
    ).toThrow('学习规划文档格式无效');
  });
});
