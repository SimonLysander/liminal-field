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
};
