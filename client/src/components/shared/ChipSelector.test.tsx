/**
 * ChipSelector 单测 — TDD 先行,覆盖 5 个核心场景。
 * spec: docs/superpowers/specs/2026-06-03-agent-skills-design.md §6.1
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChipSelector } from './ChipSelector';

const ALL = ['web_search', 'recall_memory', 'web_fetch', 'Bash'];

describe('<ChipSelector>', () => {
  it('selected 渲染为 chip,每个 chip 有 × 移除按钮', () => {
    render(
      <ChipSelector
        selected={['web_search', 'recall_memory']}
        available={ALL}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText('web_search')).toBeInTheDocument();
    expect(screen.getByText('recall_memory')).toBeInTheDocument();
  });

  it('点击 chip 上的 × 调 onRemove', () => {
    const onRemove = vi.fn();
    render(
      <ChipSelector
        selected={['web_search']}
        available={ALL}
        onAdd={() => {}}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText('移除 web_search'));
    expect(onRemove).toHaveBeenCalledWith('web_search');
  });

  it('点击 + 按钮弹 popover,只列未 selected 的项', () => {
    render(
      <ChipSelector
        selected={['web_search']}
        available={ALL}
        onAdd={() => {}}
        onRemove={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/添加/));
    // popover 应该出现 recall_memory / web_fetch / Bash,不该有 web_search
    expect(screen.queryAllByText('web_search').length).toBe(1); // 只有 chip
    expect(screen.getByText('recall_memory')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
  });

  it('选 popover 项调 onAdd', () => {
    const onAdd = vi.fn();
    render(
      <ChipSelector
        selected={[]}
        available={ALL}
        onAdd={onAdd}
        onRemove={() => {}}
      />,
    );
    fireEvent.click(screen.getByText(/添加/));
    fireEvent.click(screen.getByText('web_search'));
    expect(onAdd).toHaveBeenCalledWith('web_search');
  });

  it('groupBy:popover 内按组分类(可加 / 不可加),disabled 项有 tooltip', () => {
    render(
      <ChipSelector
        selected={[]}
        available={ALL}
        onAdd={() => {}}
        onRemove={() => {}}
        groupBy={(i) => (i === 'Bash' ? '不可添加' : '可添加')}
        disabledReason={(i) => (i === 'Bash' ? '缺 Bash 工具' : undefined)}
      />,
    );
    fireEvent.click(screen.getByText(/添加/));
    expect(screen.getByText('可添加')).toBeInTheDocument();
    expect(screen.getByText('不可添加')).toBeInTheDocument();
    // Bash 项不可点(应该有 disabled 状态)
    const bashRow = screen.getByText('Bash').closest('[role="button"]');
    expect(bashRow).toHaveAttribute('aria-disabled', 'true');
  });
});
