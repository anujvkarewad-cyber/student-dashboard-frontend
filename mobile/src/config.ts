const defaultBaseUrl = 'https://student-dashboard-frontend-iota.vercel.app';

const normalizeApiUrl = (value: string) => {
  const clean = value.trim().replace(/\/+$/, '');
  return clean.endsWith('/api/proxy') ? clean : `${clean}/api/proxy`;
};

export const config = {
  apiUrl: normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL || defaultBaseUrl),
  // Safe by default: development never writes into the production backend unless
  // EXPO_PUBLIC_USE_MOCKS=false is explicitly supplied at build/run time.
  useMocks: process.env.EXPO_PUBLIC_USE_MOCKS !== 'false',
  requestTimeoutMs: 30_000,
};
