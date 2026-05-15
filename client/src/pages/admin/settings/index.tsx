/*
 * SettingsPage — 系统设置页
 *
 * GitHub Settings 风格布局：左侧 tab 导航 + 右侧内容区。
 * 4 个 tab：同步、存储、集成、安全。
 * 各 tab 独立加载，不阻塞整个页面。
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  RefreshCw,
  HardDrive,
  Puzzle,
  Shield,
} from 'lucide-react';
import Topbar from '@/components/global/Topbar';
import { settingsApi } from '@/services/settings';
import type { SettingsConfigView, SettingsStatus, StorageStatus } from '@/services/settings';
import { SyncTab } from './SyncTab';
import { StorageTab } from './StorageTab';
import { IntegrationTab } from './IntegrationTab';
import { SecurityTab } from './SecurityTab';

const TABS = [
  { id: 'sync', label: '同步', icon: RefreshCw },
  { id: 'storage', label: '存储', icon: HardDrive },
  { id: 'integration', label: '集成', icon: Puzzle },
  { id: 'security', label: '安全', icon: Shield },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabId>('sync');
  const [config, setConfig] = useState<SettingsConfigView | null>(null);
  const [status, setStatus] = useState<SettingsStatus | null>(null);
  const [storageStatus, setStorageStatus] = useState<StorageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [c, s, ss] = await Promise.all([
      settingsApi.getConfig().catch(() => null),
      settingsApi.getStatus().catch(() => null),
      settingsApi.getStorageStatus().catch(() => null),
    ]);
    setConfig(c);
    setStatus(s);
    setStorageStatus(ss);
    setLastRefresh(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadAll();
  }, [loadAll]);

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
                {activeTab === 'sync' && (
                  <SyncTab
                    config={config?.sync ?? null}
                    status={status}
                    storageStatus={storageStatus}
                    loading={loading}
                    lastRefresh={lastRefresh}
                    onRefresh={loadAll}
                  />
                )}
                {activeTab === 'storage' && (
                  <StorageTab storageStatus={storageStatus} loading={loading} lastRefresh={lastRefresh} onRefresh={loadAll} />
                )}
                {activeTab === 'integration' && (
                  <IntegrationTab
                    config={config?.integration ?? null}
                    loading={loading}
                    onRefresh={loadAll}
                  />
                )}
                {activeTab === 'security' && <SecurityTab />}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}
