/*
 * SecurityTab — 安全 tab(2026-05-31 按宪法重做)。
 *
 * 1. 修改密码
 * 2. 受信任设备(列表 + 单个撤销 + 全部撤销)
 *
 * heading + divider 分段、28px 紧凑控件、ui/* 标准件、accent 紫 / danger 红字。
 */

import { useState, useEffect, useCallback } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { banner } from '@/components/ui/banner-api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { authApi } from '@/services/auth';
import { useConfirm } from '@/contexts/ConfirmContext';

const DEVICE_TOKEN_KEY = 'liminal_device_token';

type DeviceInfo = {
  id: string;
  name: string;
  trustedAt: string;
  lastUsedAt: string | null;
};

/** 紧凑字段:label(12px ink-faded) + 控件 + 可选 helper/error */
function Field({
  label,
  helper,
  error,
  children,
}: {
  label: string;
  helper?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div
        className="text-xs font-medium"
        style={{ color: 'var(--ink-faded)' }}
      >
        {label}
      </div>
      {children}
      {error ? (
        <div className="text-xs" style={{ color: 'var(--danger)' }}>
          {error}
        </div>
      ) : helper ? (
        <div className="text-xs" style={{ color: 'var(--ink-ghost)' }}>
          {helper}
        </div>
      ) : null}
    </div>
  );
}

/** 密码 input — 可切换显示/隐藏 */
function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative max-w-md">
      <Input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pr-8"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-sm p-1"
        style={{ color: 'var(--ink-ghost)' }}
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export function SecurityTab() {
  const confirm = useConfirm();

  // ─── 密码 ───
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [saving, setSaving] = useState(false);

  const canSubmit =
    currentPwd.length > 0 && newPwd.length >= 6 && newPwd === confirmPwd;
  const hasInput = currentPwd || newPwd || confirmPwd;

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
      banner.error('密码修改失败,请检查当前密码');
    } finally {
      setSaving(false);
    }
  };

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
      message: `撤销「${device.name}」的信任?该设备下次需要重新输入密码。`,
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
      {/* 页面标题 */}
      <div>
        <h1
          className="text-base font-semibold"
          style={{ color: 'var(--ink)' }}
        >
          安全
        </h1>
        <p className="mt-1 text-xs" style={{ color: 'var(--ink-ghost)' }}>
          管理登录密码和受信任的设备
        </p>
      </div>
      <Separator />

      {/* ── 修改密码 ── */}
      <section className="space-y-5">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            修改密码
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            修改后所有受信任设备不受影响,新登录会用新密码
          </p>
        </div>
        <div className="space-y-4">
          <Field label="当前密码">
            <PasswordInput value={currentPwd} onChange={setCurrentPwd} />
          </Field>
          <Field label="新密码" helper="至少 6 个字符">
            <PasswordInput
              value={newPwd}
              onChange={setNewPwd}
              placeholder="至少 6 个字符"
            />
          </Field>
          <Field
            label="确认新密码"
            error={
              confirmPwd && newPwd !== confirmPwd
                ? '两次输入不一致'
                : undefined
            }
          >
            <PasswordInput value={confirmPwd} onChange={setConfirmPwd} />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={saving || !canSubmit}
          >
            {saving ? '修改中…' : '修改密码'}
          </Button>
          {hasInput && !saving && (
            <Button variant="ghost" onClick={resetForm}>
              重置
            </Button>
          )}
        </div>
      </section>

      <Separator />

      {/* ── 受信任设备 ── */}
      <section className="space-y-4">
        <div>
          <h2
            className="text-sm font-semibold"
            style={{ color: 'var(--ink)' }}
          >
            受信任设备
          </h2>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--ink-ghost)' }}>
            勾选"信任此设备"登录的设备,下次免密;同一台设备多次登录会复用同一条记录
          </p>
        </div>

        {loadingDevices ? (
          <div className="space-y-2">
            <div
              className="h-3 w-1/2 rounded-sm animate-pulse"
              style={{ background: 'var(--shelf)' }}
            />
            <div
              className="h-3 w-1/3 rounded-sm animate-pulse"
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
                {i > 0 && <Separator />}
                <div className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-sm font-medium"
                        style={{ color: 'var(--ink)' }}
                      >
                        {device.name}
                      </span>
                      <span
                        className="rounded-sm px-1.5 py-0.5 font-mono text-2xs"
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
                          {new Date(device.lastUsedAt).toLocaleDateString(
                            'zh-CN',
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => void handleRevokeDevice(device)}
                  >
                    撤销
                  </Button>
                </div>
              </div>
            ))}

            {devices.length > 1 && (
              <div className="flex justify-end pt-3">
                <Button
                  variant="danger"
                  onClick={() => void handleRevokeAll()}
                >
                  全部撤销
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
