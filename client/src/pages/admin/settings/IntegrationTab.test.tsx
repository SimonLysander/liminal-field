/**
 * IntegrationTab Web Fetch 配置入口单测。
 *
 * 覆盖:
 *   - 渲染 Firecrawl/Jina 的网页读取配置入口
 *   - 分别保存 Firecrawl 与 Jina key 时调用 integration-config
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { IntegrationTab } from './IntegrationTab';

vi.mock('@/services/settings', () => ({
  settingsApi: {
    getConfig: vi.fn(),
    saveIntegrationConfig: vi.fn(),
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

function mockConfig() {
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
      hasFirecrawlApiKey: false,
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
  });

  it('展示 Web Fetch 配置区和两个 key 输入', async () => {
    render(<IntegrationTab />);

    await waitFor(() => {
      expect(screen.getByText('Web Fetch 网页读取')).toBeInTheDocument();
    });

    expect(screen.getByPlaceholderText('fc-...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('jina_...')).toBeInTheDocument();
  });

  it('保存 Firecrawl 与 Jina key 到 integration-config', async () => {
    render(<IntegrationTab />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('fc-...')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByPlaceholderText('fc-...'), {
      target: { value: 'fc-test' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存 Firecrawl' }));

    await waitFor(() => {
      expect(settingsApi.saveIntegrationConfig).toHaveBeenCalledWith({
        firecrawlApiKey: 'fc-test',
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
});
