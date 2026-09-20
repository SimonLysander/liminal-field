/**
 * IntegrationTab Web Fetch 配置入口单测。
 *
 * 覆盖:
 *   - 渲染 Firecrawl/Jina 的网页读取配置入口
 *   - 添加 Firecrawl 凭证并保存 Jina key
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IntegrationTab } from '../IntegrationTab';

vi.mock('@/services/settings', () => ({
  settingsApi: {
    getConfig: vi.fn(),
    saveIntegrationConfig: vi.fn(),
    addFirecrawlCredential: vi.fn(),
    updateFirecrawlCredential: vi.fn(),
    deleteFirecrawlCredential: vi.fn(),
    deleteAiProvider: vi.fn(),
  },
}));

vi.mock('@/components/ui/banner-api', () => ({
  banner: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { settingsApi } from '@/services/settings';

function mockConfig(
  firecrawlCredentials: Array<{
    id: string;
    label: string;
    maskedKey: string;
    enabled: boolean;
  }> = [],
) {
  vi.mocked(settingsApi.getConfig).mockResolvedValue({
    sync: {
      remoteUrl: null,
      hasToken: false,
      gitAuthorName: '',
      gitAuthorEmail: '',
      gitSyncCron: '',
      gitSyncEnabled: true,
    },
    integration: {
      hasMineruToken: false,
      hasTavilyApiKey: false,
      firecrawlCredentials,
      hasJinaApiKey: false,
    },
    ai: {
      providers: [],
      activeProviderId: '',
      aiSystemPrompt: '',
    },
    agent: { configs: [] },
    owner: { name: '', birthday: '', bio: '' },
  } as Awaited<ReturnType<typeof settingsApi.getConfig>>);
}

describe('<IntegrationTab> Web Fetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig();
    vi.mocked(settingsApi.saveIntegrationConfig).mockResolvedValue({
      success: true,
    });
    vi.mocked(settingsApi.addFirecrawlCredential).mockResolvedValue({
      success: true,
      id: 'fc-1',
    });
    vi.mocked(settingsApi.updateFirecrawlCredential).mockResolvedValue({
      success: true,
    });
    vi.mocked(settingsApi.deleteFirecrawlCredential).mockResolvedValue({
      success: true,
    });
  });

  it('展示 Web Fetch 配置区和两个 key 输入', async () => {
    render(<IntegrationTab />);

    await waitFor(() => {
      expect(screen.getByText('Web Fetch 网页读取')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('fc-...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('jina_...')).toBeInTheDocument();
  });

  it('添加 Firecrawl 凭证并保存 Jina key', async () => {
    render(<IntegrationTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('fc-...')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('fc-...'), {
      target: { value: 'fc-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加凭证' }));

    await waitFor(() => {
      expect(settingsApi.addFirecrawlCredential).toHaveBeenCalledWith({
        label: undefined,
        apiKey: 'fc-test',
      });
    });

    fireEvent.change(screen.getByPlaceholderText('jina_...'), {
      target: { value: 'jina-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Jina' }));

    await waitFor(() => {
      expect(settingsApi.saveIntegrationConfig).toHaveBeenCalledWith({
        jinaApiKey: 'jina-test',
      });
    });
  });

  it('展示、停用和删除 Firecrawl 凭证', async () => {
    mockConfig([
      {
        id: 'fc-1',
        label: '备用账户',
        maskedKey: '••••1234',
        enabled: true,
      },
    ]);
    render(<IntegrationTab />);

    expect(await screen.findByText('备用账户')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('switch', { name: '备用账户启用状态' }));
    await waitFor(() => {
      expect(settingsApi.updateFirecrawlCredential).toHaveBeenCalledWith(
        'fc-1',
        { enabled: false },
      );
    });

    fireEvent.click(screen.getByRole('button', { name: '删除备用账户' }));
    await waitFor(() => {
      expect(settingsApi.deleteFirecrawlCredential).toHaveBeenCalledWith(
        'fc-1',
      );
    });
  });
});
