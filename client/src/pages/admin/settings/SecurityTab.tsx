/*
 * SecurityTab — 安全 tab
 *
 * 1. 修改密码
 * 2. 设备信任管理（列表 + 单个撤销 + 全部撤销）
 */

import { useState, useEffect, useCallback } from 'react';
import { banner } from '@/components/ui/banner-api';
import { authApi } from '@/services/auth';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  PageHeader,
  Section,
  FieldLabel,
  TextInput,
  Divider,
  PrimaryButton,
  SecondaryButton,
  DangerButton,
} from './SettingsUI';

const DEVICE_TOKEN_KEY = 'liminal_device_token';

type DeviceInfo = {
  id: string;
  name: string;
  trustedAt: string;
  lastUsedAt: string | null;
};

export function SecurityTab() {
  const confirm = useConfirm();

  // ─── 密码 ───

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit =
    currentPwd.length > 0 && newPwd.length >= 6 && newPwd === confirmPwd;

  const resetForm = useCallback(() => {
    setCurrentPwd('');
    setNewPwd('');
    setConfirmPwd('');
  }, []);

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      await authApi.changePassword(currentPwd, newPwd);
      banner.success('密码修改成功');
      resetForm();
    } catch {
      banner.error('密码修改失败，请检查当前密码');
    } finally {
      setSaving(false);
    }
  };

  const hasInput = currentPwd || newPwd || confirmPwd;

  // ─── 设备 ───

  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const list = await authApi.listDevices();
      setDevices(list);
    } catch {
      /* 静默 */
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 初始数据加载
    void loadDevices();
  }, [loadDevices]);

  const handleRevokeDevice = async (device: DeviceInfo) => {
    const ok = await confirm({
      title: '撤销设备信任',
      message: `撤销「${device.name}」的信任？该设备下次需要重新输入密码。`,
      confirmLabel: '撤销',
      danger: true,
    });
    if (!ok) return;
    try {
      await authApi.revokeDevice(device.id);
      banner.success(`已撤销「${device.name}」`);
      await loadDevices();
    } catch {
      banner.error('操作失败');
    }
  };

  const handleRevokeAll = async () => {
    const ok = await confirm({
      title: '撤销所有设备信任',
      message: '所有设备下次登录需要重新输入密码。',
      confirmLabel: '全部撤销',
      danger: true,
    });
    if (!ok) return;
    try {
      await authApi.revokeDevices();
      localStorage.removeItem(DEVICE_TOKEN_KEY);
      banner.success('已撤销所有设备');
      await loadDevices();
    } catch {
      banner.error('操作失败');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader>安全</PageHeader>

      {/* ── 密码 ── */}
      <Section title="修改密码">
        <div className="space-y-3">
          <div>
            <FieldLabel>当前密码</FieldLabel>
            <TextInput
              value={currentPwd}
              onChange={setCurrentPwd}
              type="password"
            />
          </div>
          <div>
            <FieldLabel>新密码</FieldLabel>
            <TextInput
              value={newPwd}
              onChange={setNewPwd}
              type="password"
              placeholder="至少 6 个字符"
            />
          </div>
          <div>
            <FieldLabel>确认新密码</FieldLabel>
            <TextInput
              value={confirmPwd}
              onChange={setConfirmPwd}
              type="password"
            />
            {confirmPwd && newPwd !== confirmPwd && (
              <div
                className="mt-1 text-xs"
                style={{ color: 'var(--mark-red)' }}
              >
                两次输入不一致
              </div>
            )}
          </div>
          <div className="flex gap-2 pt-1">
            <PrimaryButton
              onClick={() => void handleSubmit()}
              disabled={saving || !canSubmit}
            >
              {saving ? '修改中...' : '修改密码'}
            </PrimaryButton>
            {hasInput && (
              <SecondaryButton onClick={resetForm}>重置</SecondaryButton>
            )}
          </div>
        </div>
      </Section>

      {/* ── 设备信任 ── */}
      <Section title="受信任设备">
        {loadingDevices ? (
          <div
            className="animate-pulse space-y-3"
          >
            <div
              className="h-3 w-1/2 rounded"
              style={{ background: 'var(--shelf)' }}
            />
            <div
              className="h-3 w-1/3 rounded"
              style={{ background: 'var(--shelf)' }}
            />
          </div>
        ) : devices.length === 0 ? (
          <div className="text-sm" style={{ color: 'var(--ink-ghost)' }}>
            暂无受信任设备
          </div>
        ) : (
          <div className="space-y-0">
            {devices.map((device, i) => (
              <div key={device.id}>
                {i > 0 && <Divider />}
                <div className="flex items-center justify-between gap-4 py-1">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--ink)' }}
                      >
                        {device.name}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 font-mono text-2xs"
                        style={{
                          background: 'var(--shelf)',
                          color: 'var(--ink-ghost)',
                        }}
                      >
                        {device.id}
                      </span>
                    </div>
                    <div
                      className="mt-0.5 flex gap-3 text-xs"
                      style={{ color: 'var(--ink-ghost)' }}
                    >
                      <span>
                        信任于{' '}
                        {new Date(device.trustedAt).toLocaleDateString('zh-CN')}
                      </span>
                      {device.lastUsedAt && (
                        <span>
                          最近{' '}
                          {new Date(device.lastUsedAt).toLocaleDateString('zh-CN')}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevokeDevice(device)}
                    className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium"
                    style={{ color: 'var(--mark-red)' }}
                  >
                    撤销
                  </button>
                </div>
              </div>
            ))}

            {devices.length > 1 && (
              <>
                <Divider />
                <div className="flex justify-end pt-1">
                  <DangerButton onClick={() => void handleRevokeAll()}>
                    全部撤销
                  </DangerButton>
                </div>
              </>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
