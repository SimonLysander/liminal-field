import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WriteApprovalCard } from './WriteApprovalCard';

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
});
