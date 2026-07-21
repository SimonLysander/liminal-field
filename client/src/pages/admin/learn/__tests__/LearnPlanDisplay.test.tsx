import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PlanProduct } from '../LearnPlanProduct';
import type { LearnPlan } from '@/services/workspace';

vi.mock('@/components/shared/CopyPageButton', () => ({
  CopyPageButton: ({
    page,
  }: {
    page: { bodyMarkdown: string; metadata?: Array<{ key?: string; value: unknown }> };
  }) => (
    <pre
      data-testid="copied-page"
      data-metadata={JSON.stringify(page.metadata ?? [])}
    >
      {page.bodyMarkdown}
    </pre>
  ),
}));

vi.mock('@/components/shared/PlateReadOnly', () => ({
  default: ({ markdown }: { markdown: string }) => (
    <div data-testid="plate-read-only">{markdown}</div>
  ),
}));

const plan: LearnPlan = {
  goal: '理解光如何成为画面',
  understanding:
    '摄影首先是记录光的过程。\n\n学习它，是为了把偶然拍到变成主动选择。\n\n这份笔记将沿成像、曝光与表达逐步展开。',
  items: [
    {
      title: '成像基础',
      thread: '物理起点',
      why: '先理解光如何形成图像。',
    },
  ],
  conclusion: '由成像走向表达，参数最终应成为判断工具。',
};

describe('PlanProduct', () => {
  it('renders a scoped retry state for a plan-only failure', () => {
    render(
      <PlanProduct
        plan={null}
        title="摄影"
        error="规划服务暂时不可用"
        onRetry={vi.fn()}
        onPlanWithAurora={vi.fn()}
      />,
    );

    expect(screen.getByText('规划服务暂时不可用')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重新加载' })).toBeInTheDocument();
  });

  it('renders one summary, two Plate prose regions, and the existing node line once', () => {
    render(
      <PlanProduct plan={plan} title="摄影" onPlanWithAurora={vi.fn()} />,
    );

    expect(screen.getByText('概要')).toBeInTheDocument();
    expect(screen.getByText(plan.goal)).toBeInTheDocument();
    const proseRegions = screen.getAllByTestId('plate-read-only');
    expect(proseRegions).toHaveLength(2);
    expect(proseRegions[0]).toHaveTextContent('摄影首先是记录光的过程。');
    expect(proseRegions[1]).toHaveTextContent(plan.conclusion);
    expect(screen.getAllByText('成像基础')).toHaveLength(1);
    expect(screen.getAllByText('先理解光如何形成图像。')).toHaveLength(1);

    const copied = screen.getByTestId('copied-page').textContent ?? '';
    expect(copied).not.toContain(plan.goal);
    expect(copied).toContain(plan.conclusion);
    expect(copied.match(/成像基础/g)).toHaveLength(1);
    expect(screen.getByTestId('copied-page').dataset.metadata).toContain(
      `"value":"${plan.goal}"`,
    );
  });
});
