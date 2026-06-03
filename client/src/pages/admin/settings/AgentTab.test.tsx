/**
 * AgentTab SkillsSection 集成单测
 *
 * 重点验证 spec §6.3 的核心交互:
 *   - 技能按 agent.tools 自动分「可添加 / 不可添加」组
 *   - 不可添加项 disabledReason 列出缺哪些工具
 *   - 加 skill 调 saveAgentConfig 传 enabledSkillIds(走后端严格 validate 路径)
 *   - 后端返 cleaned 时 toast 告知(workflow 的 §3.4 部分,服务端联动)
 *
 * 不在这里跑 ChipSelector 通用行为(已在 ChipSelector.test.tsx 覆盖)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AgentTab } from './AgentTab';

vi.mock('@/services/settings', () => ({
  settingsApi: {
    getAgentConfigs: vi.fn(),
    getConfig: vi.fn(),
    getAvailableTools: vi.fn(),
    saveAgentConfig: vi.fn(),
    saveAiSystemPrompt: vi.fn(),
  },
}));

vi.mock('@/services/skills', () => ({
  skillsApi: {
    list: vi.fn(),
  },
}));

// MemoriesSection 子组件用 listObservations,mock 避免真发请求
vi.mock('@/services/agent', () => ({
  listObservations: vi.fn().mockResolvedValue({
    observations: [],
    total: 0,
    currentView: '',
  }),
}));

vi.mock('@/components/ui/banner-api', () => ({
  banner: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { settingsApi } from '@/services/settings';
import { skillsApi } from '@/services/skills';
import { banner } from '@/components/ui/banner-api';

const mkAgent = (over: Record<string, unknown> = {}) => ({
  key: 'aurora',
  name: 'Aurora',
  description: '写作助手',
  enabled: true,
  systemPrompt: '',
  tools: ['recall_memory'], // 注意:故意不含 web_search
  tier: 'standard',
  providerId: 'p1',
  flashProviderId: '',
  standardProviderId: '',
  thinkProviderId: '',
  visionProviderId: '',
  enabledSkillIds: [],
  ...over,
});

const mkSkill = (over: Record<string, unknown> = {}) => ({
  _id: 'sk-1',
  name: 'critic',
  displayName: '批评家',
  description: 'x',
  whenToUse: 'x',
  body: 'x',
  requiredTools: ['web_search'], // 需要 web_search,agent 没开 → 应进「不可添加」组
  createdAt: '2026-06-03T00:00:00Z',
  updatedAt: '2026-06-03T00:00:00Z',
  ...over,
});

describe('<AgentTab> SkillsSection 集成', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(settingsApi.getAgentConfigs).mockResolvedValue([mkAgent()]);
    vi.mocked(settingsApi.getAvailableTools).mockResolvedValue([
      'web_search',
      'recall_memory',
    ]);
    vi.mocked(settingsApi.getConfig).mockResolvedValue({
      sync: {
        remoteUrl: null,
        hasToken: false,
        gitAuthorName: '',
        gitAuthorEmail: '',
        gitSyncCron: '',
        gitSyncEnabled: false,
      },
      integration: { hasMineruToken: false, hasTavilyApiKey: false },
      ai: {
        providers: [{ id: 'p1', provider: 'deepseek', name: 'DeepSeek', flashModel: '', standardModel: '', thinkModel: '', visionModel: '', hasApiKey: true }],
        activeProviderId: 'p1',
        aiSystemPrompt: '',
      },
      agent: { configs: [] },
      owner: { name: '', birthday: '', bio: '' },
    } as unknown as Awaited<ReturnType<typeof settingsApi.getConfig>>);
  });

  it('技能依赖工具缺失 → 进入「不可添加」组,disabledReason 列出缺哪些', async () => {
    vi.mocked(skillsApi.list).mockResolvedValue([mkSkill()]);

    render(<AgentTab />);

    // 等数据加载完成
    await waitFor(() => {
      expect(screen.getByText('Aurora')).toBeInTheDocument();
    });

    // 进编辑态
    fireEvent.click(screen.getByText('编辑'));

    // 展开 SkillsSection 的 popover
    const addBtns = screen.getAllByText(/授权技能/);
    fireEvent.click(addBtns[0]);

    // 「不可添加」组标题出现
    await waitFor(() => {
      expect(screen.getByText('不可添加')).toBeInTheDocument();
    });

    // 「批评家」项 tooltip 列出缺哪些工具
    const criticItem = screen.getByText('批评家').closest('[role="button"]');
    expect(criticItem).toHaveAttribute('aria-disabled', 'true');
    expect(criticItem).toHaveAttribute(
      'title',
      expect.stringContaining('web_search'),
    );
  });

  it('技能依赖工具齐备 → 进入「可添加」组,点击后调 saveAgentConfig 带 enabledSkillIds', async () => {
    // 给 agent 加上 web_search,skill 现在合规
    vi.mocked(settingsApi.getAgentConfigs).mockResolvedValue([
      mkAgent({ tools: ['web_search', 'recall_memory'] }),
    ]);
    vi.mocked(skillsApi.list).mockResolvedValue([mkSkill()]);
    vi.mocked(settingsApi.saveAgentConfig).mockResolvedValue({
      success: true,
      cleaned: [],
    });

    render(<AgentTab />);

    await waitFor(() => {
      expect(screen.getByText('Aurora')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('编辑'));

    // 打开 SkillsSection popover
    const addBtns = screen.getAllByText(/授权技能/);
    fireEvent.click(addBtns[0]);

    // 「可添加」组下点「批评家」
    await waitFor(() => {
      expect(screen.getByText('可添加')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('批评家'));

    // 提交保存
    // 全局 system prompt 区也有「保存」按钮,取编辑表单(后渲染的)那一个
    const saveBtns = screen.getAllByText('保存');
    fireEvent.click(saveBtns[saveBtns.length - 1]);

    await waitFor(() => {
      expect(settingsApi.saveAgentConfig).toHaveBeenCalled();
    });
    // 校验传给 saveAgentConfig 的 enabledSkillIds 包含「批评家」的 id
    const [, updated] = vi.mocked(settingsApi.saveAgentConfig).mock.calls[0];
    expect(updated.enabledSkillIds).toContain('sk-1');
  });

  it('保存返 cleaned 列表 → banner.info 告知用户哪些 skill 被自动取消', async () => {
    vi.mocked(settingsApi.getAgentConfigs).mockResolvedValue([
      mkAgent({
        tools: ['recall_memory'],
        enabledSkillIds: ['sk-1'], // 已授权但缺 web_search
      }),
    ]);
    vi.mocked(skillsApi.list).mockResolvedValue([mkSkill()]);
    vi.mocked(settingsApi.saveAgentConfig).mockResolvedValue({
      success: true,
      cleaned: [{ agent: 'aurora', skillName: 'critic' }],
    });

    render(<AgentTab />);
    await waitFor(() => {
      expect(screen.getByText('Aurora')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('编辑'));
    // 全局 system prompt 区也有「保存」按钮,取编辑表单(后渲染的)那一个
    const saveBtns = screen.getAllByText('保存');
    fireEvent.click(saveBtns[saveBtns.length - 1]);

    await waitFor(() => {
      expect(banner.info).toHaveBeenCalled();
    });
    // 提示文案包含 skill 名
    const msg = vi.mocked(banner.info).mock.calls[0][0];
    expect(msg).toContain('critic');
  });
});
