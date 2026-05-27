import { describe, expect, it } from 'vitest';
import {
  findTextRangeInContainer,
  getSelectionTextInContainer,
} from './use-selected-text';

describe('getSelectionTextInContainer', () => {
  it('returns selected text only when the selection starts inside the target container', () => {
    document.body.innerHTML = `
      <div data-slate-editor="true"><span id="inside">添加到聊天的文字</span></div>
      <div><span id="outside">外部文字</span></div>
    `;
    const inside = document.querySelector('#inside')!;
    const range = document.createRange();
    range.setStart(inside.firstChild!, 0);
    range.setEnd(inside.firstChild!, 5);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getSelectionTextInContainer('[data-slate-editor]')).toBe(
      '添加到聊天',
    );
  });

  it('returns undefined for collapsed or outside selections', () => {
    document.body.innerHTML = `
      <div data-slate-editor="true"><span id="inside">编辑器文字</span></div>
      <div><span id="outside">外部文字</span></div>
    `;
    const outside = document.querySelector('#outside')!;
    const range = document.createRange();
    range.setStart(outside.firstChild!, 0);
    range.setEnd(outside.firstChild!, 2);

    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    expect(getSelectionTextInContainer('[data-slate-editor]')).toBeUndefined();

    const inside = document.querySelector('#inside')!;
    const collapsed = document.createRange();
    collapsed.setStart(inside.firstChild!, 1);
    collapsed.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsed);

    expect(getSelectionTextInContainer('[data-slate-editor]')).toBeUndefined();
  });
});

describe('findTextRangeInContainer', () => {
  it('finds a text snapshot even when it spans multiple text nodes', () => {
    document.body.innerHTML = `
      <div data-slate-editor="true">
        <p><span>前半句</span><strong>后半句</strong><span>尾巴</span></p>
      </div>
    `;

    const range = findTextRangeInContainer('[data-slate-editor]', '半句后半');

    expect(range?.toString()).toBe('半句后半');
  });

  it('returns undefined when snapshot cannot be located', () => {
    document.body.innerHTML = `
      <div data-slate-editor="true"><p>编辑器文字</p></div>
    `;

    expect(
      findTextRangeInContainer('[data-slate-editor]', '不存在的文字'),
    ).toBeUndefined();
  });
});
