const defaultBaseUrl = 'https://student-dashboard-frontend-iota.vercel.app';

const normalizeApiUrl = (value: string) => {
  const clean = value.trim().replace(/\/+$/, '');
  return clean.endsWith('/api/proxy') ? clean : `${clean}/api/proxy`;
};

export const config = {
  apiUrl: normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL || defaultBaseUrl),
  // Controls the initial mode. Safe-preview builds start with mock data and may
  // opt into a runtime Live read-only mode; server-side writes remain blocked.
  useMocks: process.env.EXPO_PUBLIC_USE_MOCKS !== 'false',
  requestTimeoutMs: 30_000,
};
