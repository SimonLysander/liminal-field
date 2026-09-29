import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IconRail } from '../IconRail';

vi.mock('@/App', () => ({ resetAuth: vi.fn() }));
vi.mock('../SyncDialog', () => ({ SyncDialog: () => null }));
vi.mock('@/components/global/SearchPanel', () => ({
  SearchPanel: ({ open }: { open: boolean }) => (open ? <div role="dialog">搜索内容</div> : null),
}));

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

function renderRail() {
  return render(
    <MemoryRouter initialEntries={['/admin/notes']}>
      <IconRail />
      <CurrentPath />
    </MemoryRouter>,
  );
}

describe('IconRail', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.setAttribute('data-theme', 'daylight');
  });

  it.each([
    ['笔记管理', 'notebook-pen', '/admin/notes'],
    ['文集管理', 'book-open-text', '/admin/anthology'],
    ['画廊管理', 'image', '/admin/gallery'],
  ])('uses the shared %s icon without changing navigation', (label, iconName, path) => {
    renderRail();
    const button = screen.getByRole('button', { name: label });
    expect(button.querySelector('svg')).toHaveAttribute('data-icon-name', iconName);
    expect(button.querySelector('svg')).toHaveAttribute('width', '16');

    fireEvent.click(button);
    expect(screen.getByTestId('current-path')).toHaveTextContent(path);
  });

  it('opens search from the animated search button', () => {
    renderRail();
    const button = screen.getByRole('button', { name: '搜索' });
    expect(button.querySelector('svg')).toHaveAttribute('data-icon-name', 'search');
    fireEvent.click(button);
    expect(screen.getByRole('dialog')).toHaveTextContent('搜索内容');
  });

  it('keeps one SunMoon icon and describes the next theme', () => {
    renderRail();
    const button = screen.getByRole('button', { name: '切换至深色' });
    expect(button.querySelector('svg')).toHaveAttribute('data-icon-name', 'sun-moon');
    fireEvent.click(button);
    expect(document.body).toHaveAttribute('data-theme', 'midnight');
    expect(screen.getByRole('button', { name: '切换至浅色' }).querySelector('svg')).toHaveAttribute(
      'data-icon-name',
      'sun-moon',
    );
  });
});
