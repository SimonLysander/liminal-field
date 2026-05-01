import { toast } from 'sonner';

const BASE_URL = '/api/v1';

export interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data: T;
}

/** 带 code 的 Error，上层可通过 isApiError() 精确判断错误类型 */
export class ApiError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function isApiError(error: unknown, code?: number): error is ApiError {
  return error instanceof ApiError && (code === undefined || error.code === code);
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const body = options?.body;
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
  const hasBody = body !== undefined && body !== null;

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(hasBody && !isFormData ? { 'Content-Type': 'application/json' } : {}),
      ...options?.headers,
    },
  });

  const text = await res.text();
  const json = text ? (JSON.parse(text) as ApiResponse<T>) : null;

  // 401：在登录页保留后端原始错误（如"密码错误"），其他页面跳转登录页
  if (res.status === 401) {
    const serverMsg = json?.msg;
    if (!window.location.pathname.startsWith('/login')) {
      toast.info('登录已过期，请重新登录');
      window.location.href = '/login';
    }
    throw new ApiError(401, serverMsg || '需要登录');
  }

  if (!text || !json) {
    if (!res.ok) throw new ApiError(res.status, `HTTP ${res.status}`);
    return undefined as T;
  }

  if (json.code !== 0) {
    throw new ApiError(json.code, json.msg || `业务错误 (code: ${json.code})`);
  }

  return json.data;
}
