/*
 * SettingsPage — 系统设置页
 *
 * GitHub Settings 风格布局：左侧 tab 导航 + 右侧内容区。
 * 6 个 tab：所有者、同步、存储、集成、安全、Agent。
 *
 * 父组件只负责布局 + URL 路由驱动的 tab 切换。
 * 各 tab 组件自包含，各自独立 fetch 数据，互不干扰。
 */

import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  HardDrive,
  Puzzle,
  Shield,
  Bot,
  User,
  Sparkles,
  Wrench,
} from 'lucide-react';
import Topbar from '@/components/global/Topbar';
import { SyncTab } from './SyncTab';
import { StorageTab } from './StorageTab';
import { IntegrationTab } from './IntegrationTab';
import { SecurityTab } from './SecurityTab';
import { AgentTab } from './AgentTab';
import { OwnerTab } from './OwnerTab';
import { SkillsTab } from './SkillsTab';
import { ToolsTab } from './ToolsTab';

type TabId =
  | 'owner'
  | 'security'
  | 'agent'
  | 'tools'
  | 'skills'
  | 'integration'
  | 'sync'
  | 'storage';

interface TabItem {
  id: TabId;
  label: string;
  icon: typeof User;
}

interface TabGroup {
  label: string;
  items: TabItem[];
}

// 业界惯例分三组(GitHub/Vercel/Linear settings):个人 / 工作区 / 系统
const TAB_GROUPS: TabGroup[] = [
  {
    label: '个人',
    items: [
      { id: 'owner', label: '资料', icon: User },
      { id: 'security', label: '安全', icon: Shield },
    ],
  },
  {
    label: '工作区',
    items: [
      { id: 'sync', label: '同步', icon: RefreshCw },
      { id: 'integration', label: '集成', icon: Puzzle },
      { id: 'agent', label: 'Agent', icon: Bot },
      // 工具 / 技能跟 Agent 同组:agent 用工具、调技能,语义堆叠
      // 顺序 agent → tools → skills:从「调度者」往「能力」走,概念由近及远
      { id: 'tools', label: '工具', icon: Wrench },
      { id: 'skills', label: '技能', icon: Sparkles },
    ],
  },
  {
    label: '系统',
    items: [{ id: 'storage', label: '存储', icon: HardDrive }],
  },
];

const TABS: TabItem[] = TAB_GROUPS.flatMap((g) => g.items);

export default function SettingsPage() {
  const { tab } = useParams<{ tab?: string }>();
  const navigate = useNavigate();

  // URL 参数驱动 tab：/admin/settings/integration → 集成 tab
  const isValidTab = (t?: string): t is TabId => TABS.some((x) => x.id === t);
  const activeTab: TabId = isValidTab(tab) ? tab : 'owner';

  const setActiveTab = (id: TabId) => navigate(`/admin/settings/${id}`, { replace: true });

  return (
    <div
      className="flex flex-1 flex-col overflow-hidden"
      style={{ background: 'var(--paper)' }}
    >
      <Topbar />
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧导航 — 分组(个人 / 工作区 / 系统),业界惯例 GitHub/Vercel/Linear */}
        <nav
          className="flex w-48 shrink-0 flex-col overflow-y-auto px-3 py-8"
          style={{ borderRight: '0.5px solid var(--separator)' }}
        >
          {TAB_GROUPS.map((group, gi) => (
            <div key={group.label} className={gi > 0 ? 'mt-5' : ''}>
              {/* 分组标签:12px ghost 大写字距,跟 Linear/Vercel 一致 */}
              <div
                className="mb-1 px-3 text-2xs font-medium uppercase tracking-wider"
                style={{ color: 'var(--ink-ghost)' }}
              >
                {group.label}
              </div>
              <div className="flex flex-col gap-0.5">
                {group.items.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      // 三态:默认(透明 + ink-faded)→ hover(浅 overlay + ink)→ selected(shelf bg + ink)
                      // active 时不加 hover bg 防叠色;color 用 className 表达让 hover utility 能 override
                      className={`relative flex h-7 items-center gap-2 rounded-sm px-3 text-left text-md transition-colors duration-100 ${
                        active
                          ? 'text-[var(--ink)]'
                          : 'text-[var(--ink-faded)] hover:bg-[var(--hover-overlay)] hover:text-[var(--ink)]'
                      }`}
                    >
                      {/* 选中态背景 — spring 滑动指示器(28px 高、rounded-sm 紧凑)。
                          用 --paper-shadow 而不是 --shelf,因为 hover bg(--hover-overlay)
                          跟 --shelf 都是 4% 黑同色,会撞色看起来"两个都选中";
                          paper-shadow 是不透明深一档,跟 hover 拉开层级 */}
                      {active && (
                        <motion.div
                          layoutId="settings-tab-indicator"
                          className="absolute inset-0 rounded-sm"
                          style={{ background: 'var(--paper-shadow)' }}
                          transition={{
                            type: 'spring',
                            stiffness: 400,
                            damping: 30,
                          }}
                        />
                      )}
                      <span className="relative flex items-center gap-2">
                        <Icon size={14} strokeWidth={1.75} />
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 右侧内容区 — tab 切换 fade 过渡 */}
        <div className="flex flex-1 flex-col overflow-y-auto px-10 py-9">
          <div className="mx-auto w-full max-w-2xl">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              >
                {activeTab === 'owner' && <OwnerTab />}
                {activeTab === 'sync' && <SyncTab />}
                {activeTab === 'storage' && <StorageTab />}
                {activeTab === 'integration' && <IntegrationTab />}
                {activeTab === 'security' && <SecurityTab />}
                {activeTab === 'agent' && <AgentTab />}
                {activeTab === 'tools' && <ToolsTab />}
                {activeTab === 'skills' && <SkillsTab />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
