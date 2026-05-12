/*
 * IntegrationTab — 集成 tab
 *
 * 外部服务配置：MinerU Token（编辑/只读模式）+ 预留 AI 模型。
 */

import { useState, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { settingsApi } from '@/services/settings';
import type { SettingsConfigView } from '@/services/settings';
import {
  PageHeader,
  Section,
  EditableSection,
  SectionSkeleton,
  FieldLabel,
  TextInput,
  StatusRow,
} from './SettingsUI';

interface IntegrationTabProps {
  config: SettingsConfigView['integration'] | null;
  loading: boolean;
  onRefresh: () => Promise<void>;
}

export function IntegrationTab({ config, loading, onRefresh }: IntegrationTabProps) {
  const [editing, setEditing] = useState(false);
  const [mineruToken, setMineruToken] = useState('');
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setMineruToken('');
    setEditing(false);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsApi.saveIntegrationConfig({
        mineruToken: mineruToken.trim() || undefined,
      });
      banner.success('集成配置已保存');
      setMineruToken('');
      setEditing(false);
      await onRefresh();
    } catch {
      banner.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader>集成</PageHeader>
        <SectionSkeleton title="MinerU" />
        <SectionSkeleton title="AI 模型" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader>集成</PageHeader>

      {/* ── MinerU ── */}
      <EditableSection
        title="MinerU"
        description="PDF 文档解析服务，用于导入功能"
        editing={editing}
        onEdit={() => {
          setMineruToken('');
          setEditing(true);
        }}
        onSave={() => void handleSave()}
        onReset={resetForm}
        saving={saving}
        viewContent={
          <StatusRow
            label="API Token"
            value={config?.hasMineruToken ? '••••••••' : '未配置'}
          />
        }
        editContent={
          <div>
            <FieldLabel>
              API Token
              {config?.hasMineruToken && !mineruToken && (
                <span className="ml-2 font-normal" style={{ color: 'var(--ink-ghost)' }}>
                  已配置，留空则不修改
                </span>
              )}
            </FieldLabel>
            <TextInput
              value={mineruToken}
              onChange={setMineruToken}
              placeholder="eyJ0eXBlIjoi..."
              type="password"
            />
          </div>
        }
      />

      {/* ── 未来：AI 模型 ── */}
      <Section
        title="AI 模型"
        description="OpenAI-compatible API 配置（即将支持）"
      >
        <div className="space-y-2 opacity-50">
          <StatusRow label="API Endpoint" value="未配置" />
          <StatusRow label="API Key" value="未配置" />
          <StatusRow label="Model" value="未配置" />
        </div>
      </Section>
    </div>
  );
}
