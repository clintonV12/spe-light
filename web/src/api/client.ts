import axios, { AxiosError } from 'axios'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

const BASE_URL = '/api/v1'

// ─── Create instance ────────────────────────────────────────────────────────
export const apiClient: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
  timeout: 15_000,
})

// ─── Token helpers ──────────────────────────────────────────────────────────
const TOKEN_KEY = 'stratplan_access'
const REFRESH_KEY = 'stratplan_refresh'

export const tokenStore = {
  getAccess: () => localStorage.getItem(TOKEN_KEY) ?? '',
  getRefresh: () => localStorage.getItem(REFRESH_KEY) ?? '',
  setTokens: (access: string, refresh: string) => {
    localStorage.setItem(TOKEN_KEY, access)
    localStorage.setItem(REFRESH_KEY, refresh)
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

// ─── Request interceptor — attach Bearer token ──────────────────────────────
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = tokenStore.getAccess()
  if (token && config.headers) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  return config
})

// ─── Response interceptor — refresh on 401 ─────────────────────────────────
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (err: unknown) => void
}> = []

const processQueue = (err: unknown, token: string | null) => {
  failedQueue.forEach((prom) => {
    if (err) prom.reject(err)
    else prom.resolve(token!)
  })
  failedQueue = []
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    if (error.response?.status !== 401 || original._retry) {
      return Promise.reject(error)
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((token) => {
        original.headers['Authorization'] = `Bearer ${token}`
        return apiClient(original)
      })
    }

    original._retry = true
    isRefreshing = true

    try {
      const { data } = await axios.post('/auth/refresh', {
        refresh_token: tokenStore.getRefresh(),
      })
      tokenStore.setTokens(data.access_token, data.refresh_token)
      apiClient.defaults.headers.common['Authorization'] =
        `Bearer ${data.access_token}`
      processQueue(null, data.access_token)
      original.headers['Authorization'] = `Bearer ${data.access_token}`
      return apiClient(original)
    } catch (err) {
      processQueue(err, null)
      tokenStore.clear()
      window.location.href = '/login'
      return Promise.reject(err)
    } finally {
      isRefreshing = false
    }
  },
)

export default apiClient
