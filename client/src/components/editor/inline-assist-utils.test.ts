import { describe, expect, it } from 'vitest';
import {
  fitInlineAssistRectToViewport,
} from './inline-assist-utils';

describe('fitInlineAssistRectToViewport', () => {
  it('keeps a tall floating surface inside the viewport', () => {
    expect(fitInlineAssistRectToViewport(720, 420, 800)).toEqual({
      maxHeight: 776,
      top: 368,
    });
  });

  it('caps very tall surfaces and keeps top margin visible', () => {
    expect(fitInlineAssistRectToViewport(40, 1200, 800)).toEqual({
      maxHeight: 776,
      top: 12,
    });
  });
});
