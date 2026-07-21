import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LearningDraftTitleInput } from '../LearningDraftTitleInput';

describe('LearningDraftTitleInput', () => {
  it('edits the draft title and flushes dirty changes on blur', () => {
    const onChange = vi.fn();
    const onSave = vi.fn();

    render(
      <LearningDraftTitleInput
        value="未命名"
        isDirty
        onChange={onChange}
        onSave={onSave}
      />,
    );

    const input = screen.getByLabelText('篇目标题');
    fireEvent.change(input, { target: { value: '新的篇目名' } });
    fireEvent.blur(input);

    expect(onChange).toHaveBeenCalledWith('新的篇目名');
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('does not save unchanged titles on blur', () => {
    const onSave = vi.fn();

    render(
      <LearningDraftTitleInput
        value="原篇目名"
        isDirty={false}
        onChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.blur(screen.getByLabelText('篇目标题'));

    expect(onSave).not.toHaveBeenCalled();
  });
});
