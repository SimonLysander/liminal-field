import { describe, expect, it } from 'vitest';
import { extractIllustrationPrompt } from './inline-assist-utils';

describe('extractIllustrationPrompt', () => {
  it('extracts the fenced image prompt from an illustration brief', () => {
    const markdown = [
      '### 配图构思',
      '',
      '生图提示词:',
      '```text',
      'Hand-drawn diagram, white background.',
      'Use black lines.',
      '```',
      '',
      '负向提示词:',
      '```text',
      'no 3d, no photo',
      '```',
    ].join('\n');

    expect(extractIllustrationPrompt(markdown)).toBe(
      'Hand-drawn diagram, white background.\nUse black lines.',
    );
  });

  it('falls back to the full brief when the prompt section is missing', () => {
    expect(extractIllustrationPrompt('### 配图构思\n\n暂不适合画图')).toBe(
      '### 配图构思\n\n暂不适合画图',
    );
  });
});
