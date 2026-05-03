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

  // 非 2xx 响应：优先用 HTTP status 作为错误码（兼容 NestJS { statusCode, message } 格式
  // 和自定义 { code, msg } 格式），确保 isApiError(e, 404) 等能正确匹配。
  if (!res.ok) {
    const msg = json.msg || (json as unknown as Record<string, unknown>)['message'] as string || `HTTP ${res.status}`;
    throw new ApiError(res.status, msg);
  }

  if (json.code !== 0) {
    throw new ApiError(json.code, json.msg || `业务错误 (code: ${json.code})`);
  }

  return json.data;
}

/** 将 params 对象转为 URL query string（跳过 undefined 值） */
export function toQueryString(params: Record<string, string | undefined>) {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) searchParams.set(key, value);
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}
