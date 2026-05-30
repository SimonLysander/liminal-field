import { describe, expect, it, vi } from 'vitest';
import { createLiveChatSelectionAttachment } from './live-chat-selection';

describe('createLiveChatSelectionAttachment', () => {
  it('expands the selected text to the containing sentence', () => {
    const selectedRange = {
      anchor: { path: [0, 0], offset: 6 },
      focus: { path: [0, 0], offset: 8 },
    };
    const sentenceRange = {
      anchor: { path: [0, 0], offset: 4 },
      focus: { path: [0, 0], offset: 10 },
    };
    const rangeRef = { current: sentenceRange, unref: vi.fn() };
    const rangeRefFn = vi.fn(() => rangeRef);
    const fullText = '第一句。第二个句子。第三句很长很长。';
    const stringFn = vi.fn((range?: typeof selectedRange | null) => {
      if (!range) return fullText;
      return fullText.slice(range.anchor.offset, range.focus.offset);
    });

    const attachment = createLiveChatSelectionAttachment({
      editor: {
        children: [{ type: 'p', children: [{ text: fullText }] }],
        selection: selectedRange,
        api: {
          after: vi.fn((_point, opts) => ({
            path: [0, 0],
            offset: opts.distance,
          })),
          end: vi.fn(() => ({ path: [0, 0], offset: fullText.length })),
          rangeRef: rangeRefFn,
          start: vi.fn(() => ({ path: [0, 0], offset: 0 })),
          string: stringFn,
          toDOMRange: vi.fn(),
        },
      },
      preview: '个句',
    });

    expect(attachment).toBeDefined();
    expect(rangeRefFn).toHaveBeenCalledWith(sentenceRange, { affinity: 'outward' });
    expect(attachment?.preview).toBe('第二个句子。');
    expect(attachment?.getText()).toBe('第二个句子。');
  });

  it('reads line text from the live range at send time', () => {
    const unref = vi.fn();
    const selection = {
      anchor: { path: [0, 0], offset: 0 },
      focus: { path: [0, 0], offset: 5 },
    };
    const rangeRef = { current: selection, unref };
    let currentText = '旧句子';

    const attachment = createLiveChatSelectionAttachment({
      editor: {
        children: [{ type: 'p', children: [{ text: '旧句子' }] }],
        selection,
        api: {
          after: vi.fn(),
          end: vi.fn(),
          rangeRef: vi.fn(() => rangeRef),
          start: vi.fn(),
          string: vi.fn(() => currentText),
          toDOMRange: vi.fn(),
        },
      },
      preview: '旧句子',
    });
    expect(attachment).toBeDefined();
    if (!attachment) throw new Error('expected attachment');

    currentText = '改过后的句子';

    expect(attachment.preview).toBe('旧句子');
    expect(attachment.getText()).toBe('改过后的句子');

    attachment.dispose();
    expect(unref).toHaveBeenCalledOnce();
  });

  it('falls back to the add-to-chat snapshot when the live range is gone', () => {
    const attachment = createLiveChatSelectionAttachment({
      editor: {
        children: [{ type: 'p', children: [{ text: '旧句子' }] }],
        selection: {
          anchor: { path: [0, 0], offset: 0 },
          focus: { path: [0, 0], offset: 3 },
        },
        api: {
          after: vi.fn(),
          end: vi.fn(),
          rangeRef: vi.fn(() => ({ current: null, unref: vi.fn() })),
          start: vi.fn(),
          string: vi.fn((range) => {
            if (!range) return '旧句子';
            return '旧句子'.slice(range.anchor.offset, range.focus.offset);
          }),
          toDOMRange: vi.fn(),
        },
      },
      preview: '旧句子',
    });
    expect(attachment).toBeDefined();
    if (!attachment) throw new Error('expected attachment');

    expect(attachment.getText()).toBe('旧句子');
    expect(attachment.getAnchor()).toEqual({
      type: 'range',
      blockIndex: 0,
      startPath: [0, 0],
      endPath: [0, 0],
      textPreview: '旧句子',
    });
  });
});
