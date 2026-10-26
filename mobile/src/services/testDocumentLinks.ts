/** Normalize only Google's Drive file links; keep document access tokens intact. */
export function drivePreviewUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== 'https:' || !['drive.google.com', 'www.drive.google.com'].includes(url.hostname)) return null;
  const id = url.pathname.match(/^\/(?:file\/)?d\/([A-Za-z0-9_-]+)(?:\/|$)/)?.[1]
    || (/^\/(?:uc|open)$/.test(url.pathname) ? url.searchParams.get('id') : '');
  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const key = url.searchParams.get('resourcekey');
  return `https://drive.google.com/file/d/${id}/preview${key ? `?resourcekey=${encodeURIComponent(key)}` : ''}`;
}

export function testDocumentPreviewUrl(raw: string): string {
  const preview = drivePreviewUrl(raw);
  if (preview) return preview;
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid document link. Please ask your mentor to check this attachment.');
  return url.href;
}
