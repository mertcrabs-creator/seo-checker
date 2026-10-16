import axios from 'axios';

/**
 * Tek axios instance'ı. Access token sadece bellekte tutulur (XSS ile localStorage'dan
 * çalınamaz); refresh token httpOnly + SameSite=Strict cookie'dedir ve JS'e görünmez.
 */
let accessToken = null;
let refreshPromise = null;
let onSessionExpired = () => {};

export const tokenStore = {
  get: () => accessToken,
  set: (t) => {
    accessToken = t;
  },
  clear: () => {
    accessToken = null;
  },
  onExpired: (fn) => {
    onSessionExpired = fn;
  },
};

export const http = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  withCredentials: true,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

http.interceptors.request.use((cfg) => {
  if (accessToken && !cfg.skipAuth) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

/** Aynı anda gelen 401'ler için tek bir refresh isteği (single-flight). */
export function refreshSession() {
  if (!refreshPromise) {
    refreshPromise = http
      .post('/auth/refresh', null, { skipAuth: true, skipRefresh: true })
      .then(({ data }) => {
        accessToken = data.accessToken;
        return data;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && original && !original.skipRefresh && !original._retried) {
      original._retried = true;
      try {
        await refreshSession();
        return http(original);
      } catch {
        accessToken = null;
        onSessionExpired();
      }
    }
    return Promise.reject(error);
  },
);

/** API hata gövdesinden kullanıcıya gösterilecek mesaj. */
export function errorMessage(err, fallback = 'Bir hata oluştu') {
  if (err?.code === 'ECONNABORTED') return 'İstek zaman aşımına uğradı';
  if (!err?.response) return err?.message === 'Network Error' ? 'Sunucuya ulaşılamıyor' : fallback;
  return err.response.data?.error?.message || fallback;
}
