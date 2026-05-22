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
} from 'lucide-react';
import Topbar from '@/components/global/Topbar';
import { SyncTab } from './SyncTab';
import { StorageTab } from './StorageTab';
import { IntegrationTab } from './IntegrationTab';
import { SecurityTab } from './SecurityTab';
import { AgentTab } from './AgentTab';
import { OwnerTab } from './OwnerTab';

const TABS = [
  { id: 'owner', label: '所有者', icon: User },
  { id: 'sync', label: '同步', icon: RefreshCw },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'integration', label: '集成', icon: Puzzle },
  { id: 'security', label: '安全', icon: Shield },
  { id: 'agent', label: 'Agent', icon: Bot },
] as const;

type TabId = (typeof TABS)[number]['id'];

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
        {/* 左侧导航 */}
        <nav
          className="flex w-48 shrink-0 flex-col gap-1 overflow-y-auto px-4 py-9"
          style={{ borderRight: '0.5px solid var(--separator)' }}
        >
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className="relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium"
                style={{
                  color: active ? 'var(--ink)' : 'var(--ink-faded)',
                }}
              >
                {/* 选中态背景 — spring 滑动指示器 */}
                {active && (
                  <motion.div
                    layoutId="settings-tab-indicator"
                    className="absolute inset-0 rounded-lg"
                    style={{ background: 'var(--shelf)' }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative flex items-center gap-2.5">
                  <Icon size={16} strokeWidth={1.75} />
                  {tab.label}
                </span>
              </button>
            );
          })}
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
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
