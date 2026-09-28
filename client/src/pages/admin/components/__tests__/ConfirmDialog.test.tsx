import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { structureApi } from '@/services/structure';
import { ConfirmDialog } from '../ConfirmDialog';

vi.mock('@/services/structure', () => ({
  structureApi: { getDeleteStats: vi.fn() },
}));

const node = { id: 'root', name: '学习主题' };

describe('ConfirmDialog', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(structureApi.getDeleteStats).mockResolvedValue({ folderCount: 1, docCount: 2 });
  });

  it('explains scoped learning termination before deletion without submitting automatically', async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog node={node} scope="notes" onConfirm={onConfirm} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '删除' })).toBeEnabled());
    expect(screen.getByText('删除范围内的学习将一并结束，范围外的学习不受影响。')).toBeInTheDocument();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not enable deletion when the deletion range could not be loaded', async () => {
    vi.mocked(structureApi.getDeleteStats).mockRejectedValue(new Error('获取范围失败'));
    render(<ConfirmDialog node={node} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    await screen.findByText('获取范围失败');
    expect(screen.getByRole('button', { name: '删除' })).toBeDisabled();
  });

  it('shows the original failure and enables retry when deletion is rejected', async () => {
    const onConfirm = vi.fn().mockRejectedValue(new Error('已发布，请先取消发布'));
    render(<ConfirmDialog node={node} onConfirm={onConfirm} onCancel={vi.fn()} />);
    const remove = screen.getByRole('button', { name: '删除' });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    await screen.findByText('已发布，请先取消发布');
    expect(remove).toBeEnabled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate deletion and cancellation while a request is pending', async () => {
    let finish!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
    const onCancel = vi.fn();
    render(<ConfirmDialog node={node} onConfirm={onConfirm} onCancel={onCancel} />);
    const remove = screen.getByRole('button', { name: '删除' });
    await waitFor(() => expect(remove).toBeEnabled());
    fireEvent.click(remove);
    fireEvent.click(remove);
    fireEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '删除中...' })).toBeDisabled();
    await act(async () => { finish(); });
  });
});
