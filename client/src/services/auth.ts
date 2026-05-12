import { request } from './request';

export const authApi = {
  login: (password: string) =>
    request<{ authenticated: boolean }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    }),

  logout: () =>
    request<{ authenticated: boolean }>('/auth/logout', {
      method: 'POST',
    }),

  check: () =>
    request<{ authenticated: boolean }>('/auth/check'),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ success: boolean }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  deviceLogin: (deviceToken: string) =>
    request<{ authenticated: boolean }>('/auth/device-login', {
      method: 'POST',
      body: JSON.stringify({ deviceToken }),
    }),

  trustDevice: () =>
    request<{ deviceToken: string }>('/auth/trust-device', {
      method: 'POST',
    }),

  listDevices: () =>
    request<
      Array<{
        id: string;
        name: string;
        trustedAt: string;
        lastUsedAt: string | null;
      }>
    >('/auth/devices'),

  revokeDevice: (id: string) =>
    request<{ success: boolean }>('/auth/revoke-device', {
      method: 'POST',
      body: JSON.stringify({ id }),
    }),

  revokeDevices: () =>
    request<{ success: boolean }>('/auth/revoke-devices', {
      method: 'POST',
    }),
};
