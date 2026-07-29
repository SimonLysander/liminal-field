// @vitest-environment node

import { BaseParagraphPlugin, createSlateEditor, type TElement } from 'platejs';
import { describe, expect, it } from 'vitest';

import { normalizeRegisteredPlateNodes } from '../plate-transforms';

describe('normalizeRegisteredPlateNodes', () => {
  it('保留已注册节点并扁平化未知行内节点', () => {
    const editor = createSlateEditor({ plugins: [BaseParagraphPlugin] });
    const input = [
      {
        type: 'p',
        children: [
          { text: '前文' },
          {
            type: 'footnote_reference',
            children: [{ text: '' }],
          },
          { text: '，后文' },
        ],
      },
    ] as TElement[];

    expect(normalizeRegisteredPlateNodes(editor, input)).toEqual({
      nodes: [
        {
          type: 'p',
          children: [{ text: '前文' }, { text: '' }, { text: '，后文' }],
        },
      ],
      unsupportedTypes: ['footnote_reference'],
    });
  });

  it('根级未知块保留可读文本并退化为段落', () => {
    const editor = createSlateEditor({ plugins: [BaseParagraphPlugin] });
    const input = [
      {
        type: 'custom_block',
        children: [{ text: '仍然可读' }],
      },
    ] as TElement[];

    expect(normalizeRegisteredPlateNodes(editor, input)).toEqual({
      nodes: [{ type: 'p', children: [{ text: '仍然可读' }] }],
      unsupportedTypes: ['custom_block'],
    });
  });
});
