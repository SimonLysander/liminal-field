import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not offer actions for a TTL-expired historical approval', () => {
    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'expired', resolvedAt: null }}
      />,
    );

    expect(screen.getByText('审批已过期')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('offers actions for a pending approval', () => {
    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
      />,
    );

    expect(screen.getByRole('button', { name: '允许' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  });

  it('does not offer actions for an approval superseded by newer content', () => {
    const resolvedAt = new Date(2026, 6, 22, 14, 30).toISOString();
    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'superseded', resolvedAt }}
      />,
    );

    expect(screen.getByText('已被更新内容取代')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '允许' })).toBeNull();
    expect(screen.queryByRole('button', { name: '拒绝' })).toBeNull();
  });

  it('shows the exact terminal state when another device already rejected it', async () => {
    const resolvedAt = new Date(2026, 6, 22, 14, 30).toISOString();
    vi.mocked(approveWrite).mockResolvedValue({
      status: 'already_resolved',
      resolution: 'rejected',
      resolvedAt,
    });

    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '允许' }));

    await waitFor(() => expect(screen.getByText(/已拒绝/)).toBeInTheDocument());
    expect(screen.queryByText('已处理')).toBeNull();
  });

  it('turns an expired approval into a terminal card after an action', async () => {
    vi.mocked(rejectWrite).mockResolvedValue({ status: 'expired' });

    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));

    await waitFor(() =>
      expect(screen.getByText('审批已过期')).toBeInTheDocument(),
    );
  });

  it('shows the authoritative server resolution time for a historical approval', () => {
    const resolvedAt = new Date(2026, 6, 22, 14, 32).toISOString();
    render(
      <WriteApprovalCard
        {...props}
        approval={{
          status: 'approved',
          resolvedAt,
        }}
      />,
    );

    const time = screen.getByText(/已写入/).querySelector('time');
    expect(time).toHaveAttribute('dateTime', resolvedAt);
    expect(time).toHaveTextContent('2026年7月22日 14:32');
  });

  it('shows the server resolution time immediately after approval', async () => {
    const resolvedAt = new Date(2026, 6, 22, 14, 32).toISOString();
    vi.mocked(approveWrite).mockResolvedValue({
      status: 'ok',
      resolvedAt,
    });

    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '允许' }));

    await waitFor(() => expect(screen.getByText(/已写入/)).toBeInTheDocument());
    expect(screen.getByText(/已写入/)).toHaveTextContent(
      '2026年7月22日 14:32',
    );
  });

  it('keeps polling an in-progress approval until the authoritative terminal state arrives', async () => {
    vi.useFakeTimers();
    const resolvedAt = new Date(2026, 6, 22, 14, 32).toISOString();
    vi.mocked(approveWrite).mockResolvedValue({ status: 'in_progress' });
    const onStatusRefresh = vi
      .fn()
      .mockResolvedValueOnce({ status: 'pending', resolvedAt: null })
      .mockResolvedValueOnce({ status: 'approved', resolvedAt });
    const onApproved = vi.fn();

    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
        onStatusRefresh={onStatusRefresh}
        onApproved={onApproved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '允许' }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(onStatusRefresh).toHaveBeenCalledTimes(2);
    expect(onApproved).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/已写入/)).toHaveTextContent(
      '2026年7月22日 14:32',
    );
  });

  it('shows the server resolution time immediately after rejection', async () => {
    const resolvedAt = new Date(2026, 6, 22, 14, 35).toISOString();
    vi.mocked(rejectWrite).mockResolvedValue({ status: 'ok', resolvedAt });

    render(
      <WriteApprovalCard
        {...props}
        approval={{ status: 'pending', resolvedAt: null }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));

    await waitFor(() => expect(screen.getByText(/已拒绝/)).toBeInTheDocument());
    expect(screen.getByText(/已拒绝/)).toHaveTextContent(
      '2026年7月22日 14:35',
    );
  });
});
