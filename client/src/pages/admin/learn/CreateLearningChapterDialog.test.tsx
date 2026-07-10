import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateLearningChapterDialog } from './CreateLearningChapterDialog';

describe('CreateLearningChapterDialog', () => {
  it('requires a title before creating a chapter', () => {
    const onConfirm = vi.fn();

    render(
      <CreateLearningChapterDialog
        open
        submitting={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(screen.getByText('请输入篇目名称')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('submits the trimmed title', () => {
    const onConfirm = vi.fn();

    render(
      <CreateLearningChapterDialog
        open
        submitting={false}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    fireEvent.change(screen.getByLabelText('篇目名称'), {
      target: { value: '  光圈和景深  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建' }));

    expect(onConfirm).toHaveBeenCalledWith('光圈和景深');
  });
});
