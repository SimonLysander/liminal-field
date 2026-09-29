import { banner } from '@/components/ui/banner-api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CodeCopyButton } from '../CodeCopyButton';

vi.mock('@/components/ui/banner-api', () => ({ banner: { error: vi.fn() } }));
vi.mock('@/lib/logger', () => ({ createLogger: () => ({ debug: vi.fn(), warn: vi.fn() }) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('CodeCopyButton', () => {
  it('only confirms copying after the clipboard write succeeds', async () => {
    let resolveWrite!: () => void;
    vi.spyOn(navigator.clipboard, 'writeText').mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        }),
    );
    render(<CodeCopyButton value="api address" />);
    fireEvent.click(screen.getByRole('button', { name: '复制全部代码' }));

    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制全部代码' })).toBeDisabled();
    resolveWrite();
    await waitFor(() => expect(screen.getByRole('button', { name: '已复制' })).toBeEnabled());
  });

  it('reports denied clipboard permissions without confirming success', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
    render(<CodeCopyButton value="api address" />);
    fireEvent.click(screen.getByRole('button', { name: '复制全部代码' }));

    await waitFor(() => expect(banner.error).toHaveBeenCalledWith('复制失败，请选择文本复制'));
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '复制全部代码' })).toBeEnabled();
  });

  it('reports missing clipboard support without an unhandled rejection', async () => {
    vi.stubGlobal('navigator', { clipboard: undefined });
    render(<CodeCopyButton value="api address" />);
    fireEvent.click(screen.getByRole('button', { name: '复制全部代码' }));
    await waitFor(() => expect(banner.error).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '已复制' })).not.toBeInTheDocument();
  });

  it('supports lazy values and does not submit a surrounding form', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const onSubmit = vi.fn();
    const value = vi.fn(() => 'generated code');
    render(
      <form onSubmit={onSubmit}>
        <CodeCopyButton value={value} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制全部代码' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('generated code'));
    expect(value).toHaveBeenCalledOnce();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('renders an optional visible label next to the icon', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    render(
      <CodeCopyButton value="instructions" copyAriaLabel="复制接入说明">
        复制接入说明
      </CodeCopyButton>,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制接入说明' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '已复制' })).toHaveTextContent('复制接入说明'),
    );
  });
});
