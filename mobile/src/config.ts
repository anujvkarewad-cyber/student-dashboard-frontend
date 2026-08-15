export type BackendDefaultMode = 'mock' | 'live-readonly' | 'live';

const defaultBaseUrl = 'https://student-dashboard-frontend-iota.vercel.app';

const normalizeApiUrl = (value: string) => {
  const clean = value.trim().replace(/\/+$/, '');
  return clean.endsWith('/api/proxy') ? clean : `${clean}/api/proxy`;
};

const requestedMode = process.env.EXPO_PUBLIC_BACKEND_MODE;
const legacyUseMocks = process.env.EXPO_PUBLIC_USE_MOCKS !== 'false';
const legacyReadOnly = process.env.EXPO_PUBLIC_READ_ONLY !== 'false';
const defaultApiMode: BackendDefaultMode = requestedMode === 'mock' || requestedMode === 'live-readonly' || requestedMode === 'live'
  ? requestedMode
  : legacyUseMocks
    ? 'mock'
    : legacyReadOnly
      ? 'live-readonly'
      : 'live';

export const config = {
  apiUrl: normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL || defaultBaseUrl),
  defaultApiMode,
  // Safe preview builds may switch modes after an explicit warning. The full-live
  // release profile locks this off so students cannot accidentally enter demo data.
  allowModeSelection: process.env.EXPO_PUBLIC_ALLOW_MODE_SWITCH !== 'false',
  requestTimeoutMs: 60_000,
};
