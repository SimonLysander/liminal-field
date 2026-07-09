import { describe, expect, it } from 'vitest';
import { buildStartLearningConfirmMessage } from './learning-entry';

describe('buildStartLearningConfirmMessage', () => {
  it('explains the selected page and scope before creating a learning project', () => {
    expect(buildStartLearningConfirmMessage('曝光三角形')).toBe(
      '将为「曝光三角形」开启学习空间。\n\n范围包含这个页面下方的所有页面；如果其中已有正在进行的学习，系统会阻止重复创建。',
    );
  });
});
