export type BackendDefaultMode = 'mock' | 'live-readonly' | 'live';

const defaultBaseUrl = 'https://student-dashboard-frontend-iota.vercel.app';

const normalizeApiUrl = (value: string) => {
  const clean = value.trim().replace(/\/+$/, '');
  return clean.endsWith('/api/proxy') ? clean : `${clean}/api/proxy`;
};

const requestedMode = process.env.EXPO_PUBLIC_BACKEND_MODE;
const productionRelease = process.env.NODE_ENV === 'production';
const legacyUseMocks = process.env.EXPO_PUBLIC_USE_MOCKS !== 'false';
const legacyReadOnly = process.env.EXPO_PUBLIC_READ_ONLY !== 'false';
const defaultApiMode: BackendDefaultMode = requestedMode === 'mock' || requestedMode === 'live-readonly' || requestedMode === 'live'
  ? requestedMode
  : productionRelease
    ? 'live'
    : legacyUseMocks
      ? 'mock'
      : legacyReadOnly
        ? 'live-readonly'
        : 'live';
const requestedModeSwitch = process.env.EXPO_PUBLIC_ALLOW_MODE_SWITCH;

export const config = {
  apiUrl: normalizeApiUrl(process.env.EXPO_PUBLIC_API_BASE_URL || defaultBaseUrl),
  defaultApiMode,
  // Student release bundles are locked to Full Live by default. Explicit EAS
  // preview/read-only profiles still override both values through environment.
  allowModeSelection: requestedModeSwitch === 'true' ? true : requestedModeSwitch === 'false' ? false : !productionRelease,
  requestTimeoutMs: 60_000,
};
