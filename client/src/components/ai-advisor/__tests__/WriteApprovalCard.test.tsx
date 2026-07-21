import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteApprovalCard } from '../WriteApprovalCard';
import { approveWrite, rejectWrite } from '@/services/agent';

vi.mock('@/services/agent', () => ({
  approveWrite: vi.fn(),
  rejectWrite: vi.fn(),
}));

describe('WriteApprovalCard', () => {
  const props = {
    toolCallId: 'call-1',
    sessionKey: 'learn-ci:chat:1',
    preview: { summary: '写入一篇初稿' },
  };

  beforeEach(() => {
    vi.mocked(approveWrite).mockReset();
    vi.mocked(rejectWrite).mockReset();
  });

  it('does not offer actions for a TTL-expired historical approval', () => {
    render(<WriteApprovalCard {...props} status="expired" />);

    expect(screen.getByText('审批已过期')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('offers actions for a pending approval', () => {
    render(<WriteApprovalCard {...props} status="pending" />);

    expect(screen.getByRole('button', { name: '允许' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  });

  it('does not offer actions for an approval superseded by newer content', () => {
    render(<WriteApprovalCard {...props} status="superseded" />);

    expect(screen.getByText('已被更新内容取代')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('shows the exact terminal state when another device already rejected it', async () => {
    vi.mocked(approveWrite).mockResolvedValue({
      status: 'already_resolved',
      resolution: 'rejected',
    });

    render(<WriteApprovalCard {...props} status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: '允许' }));

    await waitFor(() => expect(screen.getByText('已拒绝')).toBeInTheDocument());
    expect(screen.queryByText('已处理')).toBeNull();
  });

  it('turns an expired approval into a terminal card after an action', async () => {
    vi.mocked(rejectWrite).mockResolvedValue({ status: 'expired' });

    render(<WriteApprovalCard {...props} status="pending" />);
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));

    await waitFor(() =>
      expect(screen.getByText('审批已过期')).toBeInTheDocument(),
    );
  });
});
