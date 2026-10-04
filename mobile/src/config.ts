export type BackendDefaultMode = 'mock' | 'live-readonly' | 'live';

const configuredBaseUrl = (process.env.EXPO_PUBLIC_API_BASE_URL || '').trim();

const normalizeGatewayOrigin = (value: string) => value.trim().replace(/\/+$/, '').replace(/\/api\/proxy$/, '');
const gatewayOrigin = normalizeGatewayOrigin(configuredBaseUrl);

const requestedMode = process.env.EXPO_PUBLIC_BACKEND_MODE;
const defaultApiMode: BackendDefaultMode = requestedMode === 'live-readonly' || requestedMode === 'live'
  ? requestedMode
  : 'live';
const requestedModeSwitch = process.env.EXPO_PUBLIC_ALLOW_MODE_SWITCH;

export const config = {
  // Production builds receive this value from encrypted EAS environment
  // variables. There is deliberately no legacy hosting fallback.
  gatewayOrigin,
  apiUrl: gatewayOrigin ? `${gatewayOrigin}/api/proxy` : '',
  proofUploadUrl: gatewayOrigin ? `${gatewayOrigin}/api/proof-upload` : '',
  mentorApiUrl: gatewayOrigin ? `${gatewayOrigin}/api/mentor` : '',
  // Shared secret for computing the /api/progress-sync HMAC token. Leave blank
  // when the mentor backend has no SYNC_SECRET configured (dev mode accepts any
  // token); set it to the same value as the backend's SYNC_SECRET otherwise.
  mentorSyncSecret: (process.env.EXPO_PUBLIC_MENTOR_SYNC_SECRET || '').trim(),
  defaultApiMode,
  // Student release bundles are locked to Full Live by default. Explicit EAS
  // preview/read-only profiles still override both values through environment.
  allowModeSelection: requestedModeSwitch === 'true',
  requestTimeoutMs: 60_000,
  // Proof upload authenticates with Mongo and then writes through Apps Script;
  // slower mobile networks need a larger bound than ordinary JSON calls.
  proofUploadTimeoutMs: 120_000,
  appVersion: (process.env.EXPO_PUBLIC_APP_VERSION || '1.14.5').trim(),
};
