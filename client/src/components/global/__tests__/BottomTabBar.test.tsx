import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import BottomTabBar from '../BottomTabBar';

function CurrentPath() {
  return <output data-testid="current-path">{useLocation().pathname}</output>;
}

describe('BottomTabBar', () => {
  it.each([
    ['首页', 'house', '/home'],
    ['笔记', 'notebook-pen', '/note'],
    ['文集', 'book-open-text', '/anthology'],
    ['画廊', 'image', '/gallery'],
    ['简报', 'mails', '/digest'],
  ])('keeps the %s destination with the shared %s icon', (label, iconName, path) => {
    render(
      <MemoryRouter initialEntries={['/connect']}>
        <BottomTabBar />
        <CurrentPath />
      </MemoryRouter>,
    );
    const button = screen.getByRole('button', { name: label });
    const icon = button.querySelector('svg');
    expect(icon).toHaveAttribute('data-icon-name', iconName);
    expect(icon).toHaveAttribute('width', '22');

    fireEvent.click(button);
    expect(screen.getByTestId('current-path')).toHaveTextContent(path);
  });
});
