import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConnectPage from '..';
import { readingTools } from '../integration-docs';

const httpInstructions = 'Use the public HTTP API according to its OpenAPI document.';
beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ 'openapi': '3.1.0', 'x-agent-instructions': httpInstructions })),
  );
});
afterEach(() => vi.restoreAllMocks());

async function renderPage() {
  const view = render(
    <MemoryRouter>
      <ConnectPage />
    </MemoryRouter>,
  );
  // Ariakit sorts registered tabs on the next frame before keyboard navigation.
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  return view;
}

describe('ConnectPage', () => {
  it('renders public instructions without loading data or checking login', async () => {
    const fetch = vi.spyOn(window, 'fetch');
    await renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '接入说明' })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'MCP' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'HTTP' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText('Streamable HTTP')).toBeVisible();
    expect(screen.queryByRole('button', { name: '复制接口地址' })).not.toBeInTheDocument();
    expect(screen.queryByText(/AI\s*助手/)).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '切换主题' })).not.toBeInTheDocument();
  });

  it('uses this deployment origin for OpenAPI, addresses and copy actions', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await renderPage();
    const base = `${window.location.origin}/api/v1/external`;

    fireEvent.click(screen.getByRole('button', { name: '复制MCP 地址' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${base}/mcp`));
    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'HTTP' })).toBeVisible());
    expect(screen.getByRole('link', { name: '查看接口说明（OpenAPI）' })).toHaveAttribute(
      'href',
      `${base}/openapi.json`,
    );
    fireEvent.click(screen.getByRole('button', { name: '复制接口地址' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(base));
    fireEvent.click(screen.getByRole('button', { name: '复制接口说明' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${base}/openapi.json`));
    expect(screen.queryByRole('button', { name: '复制MCP 地址' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
    await waitFor(() => expect(screen.getByRole('tabpanel', { name: 'MCP' })).toBeVisible());
    expect(screen.queryByRole('link', { name: '查看接口说明（OpenAPI）' })).not.toBeInTheDocument();
  });

  it('supports keyboard navigation between the two connection modes', async () => {
    await renderPage();
    const mcp = screen.getByRole('tab', { name: 'MCP' });
    const http = screen.getByRole('tab', { name: 'HTTP' });
    act(() => mcp.focus());
    fireEvent.keyDown(mcp, { key: 'ArrowRight' });
    await waitFor(() => expect(http).toHaveFocus());
    expect(http).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'HTTP' })).toHaveAttribute(
      'aria-labelledby',
      http.id,
    );
    fireEvent.keyDown(http, { key: 'ArrowLeft' });
    await waitFor(() => expect(mcp).toHaveFocus());
    expect(mcp).toHaveAttribute('aria-selected', 'true');
  });

  it('switches examples, copied code and response formats with the selected connection method', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await renderPage();
    const example = screen.getByLabelText('浏览目录示例');
    const mcpExample = JSON.stringify(
      { name: 'browse_library', arguments: { target: 'notes' } },
      null,
      2,
    );
    expect(example).toBeVisible();
    expect(example.textContent).toBe(mcpExample);
    expect(screen.getByText('structuredContent')).toBeVisible();
    expect(screen.queryByText('code=0')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制浏览目录示例' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(mcpExample));

    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    const httpExample = readingTools(window.location.origin)[0].example;
    await waitFor(() =>
      expect(screen.getByLabelText('浏览目录示例').textContent).toBe(httpExample),
    );
    expect(screen.getByText('code=0')).toBeVisible();
    expect(screen.queryByText('structuredContent')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '复制浏览目录示例' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(httpExample));

    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
    await waitFor(() => expect(screen.getByLabelText('浏览目录示例').textContent).toBe(mcpExample));
    expect(screen.getByLabelText('浏览目录示例')).toBeVisible();
  });

  it('provides four always-visible parameter tables and matching outline anchors', async () => {
    await renderPage();
    expect(document.querySelector('details')).toBeNull();
    expect(screen.getAllByRole('table')).toHaveLength(4);
    for (const name of ['browse_library', 'search_content', 'read_content', 'read_asset']) {
      expect(screen.getByText(name)).toBeVisible();
    }
    for (const entry of document.querySelectorAll<HTMLElement>('[data-toc-id]')) {
      const heading = document.getElementById(entry.dataset.tocId!);
      expect(heading).not.toBeNull();
      expect(heading).toHaveAttribute('data-heading-id', entry.dataset.tocId);
    }
  });

  it('keeps each tool summary, parameter table and example visible without extra actions', async () => {
    await renderPage();
    for (const tool of readingTools(window.location.origin)) {
      const section = within(screen.getByRole('region', { name: '可读取的内容' })).getByRole(
        'region',
        { name: tool.title },
      );
      expect(within(section).getByText(tool.summary)).toBeVisible();
      const reference = within(screen.getByRole('region', { name: '技术说明' })).getByRole(
        'region',
        { name: tool.title },
      );
      expect(within(reference).getByText(tool.name)).toBeVisible();
      expect(within(reference).getByText(tool.description)).toBeVisible();
      expect(within(reference).getByRole('table', { name: `${tool.title}参数` })).toBeVisible();
      expect(within(reference).getByLabelText(`${tool.title}示例`)).toBeVisible();
    }
  });

  it('keeps pagination, error handling and permission boundaries visible', async () => {
    await renderPage();
    expect(screen.getByText('RESOURCE_NOT_FOUND')).toBeVisible();
    expect(screen.getByText(/持续使用/)).toBeVisible();
    expect(screen.getByText(/仅提供访客可见的内容/)).toBeVisible();
    expect(screen.getByText(/此接入仅用于读取/)).toBeVisible();
    expect(screen.getByText(/附件提供实际文件/)).toBeVisible();
  });

  it('loads and copies HTTP instructions without changing the MCP address copy action', async () => {
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    await renderPage();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: '复制 HTTP 接入说明' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: '复制 HTTP 接入说明' })).toBeEnabled(),
    );
    expect(screen.getByLabelText('HTTP 接入说明').textContent).toBe(httpInstructions);
    fireEvent.click(screen.getByRole('button', { name: '复制 HTTP 接入说明' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(httpInstructions));

    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
    fireEvent.click(screen.getByRole('button', { name: '复制MCP 地址' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith(`${window.location.origin}/api/v1/external/mcp`),
    );
  });

  it('waits for instructions before enabling copy and cancels requests on leaving HTTP', async () => {
    let finish!: (response: Response) => void;
    vi.mocked(globalThis.fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    expect(screen.getByRole('button', { name: '复制 HTTP 接入说明' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('正在获取接入说明');
    const signal = vi.mocked(globalThis.fetch).mock.calls[0][1]?.signal;
    expect(signal?.aborted).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'MCP' }));
    expect(signal?.aborted).toBe(true);

    await act(async () => {
      finish(
        new Response(
          JSON.stringify({ 'openapi': '3.1.0', 'x-agent-instructions': httpInstructions }),
        ),
      );
    });
    expect(screen.queryByLabelText('HTTP 接入说明')).not.toBeInTheDocument();
  });

  it('keeps the OpenAPI address usable when instructions cannot be retrieved', async () => {
    vi.mocked(globalThis.fetch).mockRejectedValue(new TypeError('Failed to fetch'));
    await renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'HTTP' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('接入说明暂时无法获取'),
    );
    expect(screen.getByRole('button', { name: '复制 HTTP 接入说明' })).toBeDisabled();
    expect(screen.getByRole('link', { name: '查看接口说明（OpenAPI）' })).toBeVisible();
    expect(screen.getByRole('button', { name: '复制接口说明' })).toBeEnabled();
  });

  it('generates curl examples with encoded parameters, not raw URLs containing references', () => {
    const tools = readingTools('https://docs.example');
    expect(tools.map((tool) => tool.path)).toEqual(['/browse', '/search', '/content', '/assets']);
    for (const tool of tools) {
      expect(tool.example).toContain("BASE='https://docs.example/api/v1/external'");
      expect(tool.example).toContain('curl --fail-with-body --get');
      expect(tool.example).toContain('--data-urlencode');
      expect(tool.example).not.toContain('lux-stirring.space');
    }
    expect(tools[2].example).toContain('target=$TARGET');
    expect(tools[3].example).toContain('assetRef=$ASSET_REF');
    expect(tools[3].example).toContain('--output attachment');
    expect(tools.map((tool) => tool.exampleArguments)).toEqual([
      { target: 'notes' },
      { query: '相机', within: 'notes' },
      { target: '返回的 target' },
      { assetRef: '返回的 assetRef' },
    ]);
  });
});
