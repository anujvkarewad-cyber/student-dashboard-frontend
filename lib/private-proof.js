/** New-file owner-only protocol. No ACL writes, legacy ownership inference, or Script fallback. */
export const PRIVATE_PROOF_PROTOCOL = 'private-v1';
const MAX = 10 * 1024 * 1024;
const TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']);
const validId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{5,200}$/.test(value);
const fail = () => { throw new Error('Private proof access could not be confirmed. Keep your draft.'); };
const options = token => ({ headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(25000) });
async function metadata(id, token) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?supportsAllDrives=true&fields=id,mimeType,size,trashed,appProperties,driveId,capabilities(canAddChildren)`, options(token));
  if (!response.ok || response.redirected) fail();
  const data = await response.json();
  if (!data || data.id !== id || data.trashed !== false || data.error || data.ok === false || data.success === false) fail();
  return data;
}
async function requirePrivateAcl(id, token, principal) {
  if (!principal) fail();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/permissions?supportsAllDrives=true&pageSize=100&fields=nextPageToken,permissions(type,role,emailAddress,deleted)`, options(token));
  if (!response.ok || response.redirected) fail();
  const data = await response.json();
  const members = Array.isArray(data.permissions) ? data.permissions.filter(p => p.deleted !== true) : [];
  if (data.error || data.ok === false || data.success === false || data.nextPageToken || !members.length) fail();
  // Private audience: user-type grants only — never 'anyone', 'domain' or groups.
  if (!members.every(p => p.type === 'user' && typeof p.emailAddress === 'string')) fail();
  // The drive principal itself must hold write-capable access to the item.
  if (!members.some(p => p.emailAddress.toLowerCase() === principal.toLowerCase() && ['owner','writer','organizer','fileOrganizer'].includes(p.role))) fail();
}
/**
 * The owner-side upload script still speaks the legacy dialect: every file it
 * creates is shared "anyone with the link" so old APKs can open it in a
 * browser. Once a file is bound to one student the public grant is both a leak
 * and a read-blocker — requirePrivateAcl refuses files reachable outside the
 * user roster. Modern clients only ever receive the header-gated /api/proof-file
 * URL, so after binding we remove the public grant. A 404-delete (grant already
 * absent) is fine; anything else fails the upload rather than leaving a proof
 * public-or-unreadable.
 */
export async function stripPublicProofGrants(fileId, token) {
  if (!validId(fileId)) fail();
  const list = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions?supportsAllDrives=true&pageSize=100&fields=permissions(id,type)`, options(token));
  if (!list.ok || list.redirected) fail();
  const data = await list.json();
  const members = Array.isArray(data.permissions) ? data.permissions : [];
  const publicGrants = members.filter(p => p && typeof p.id === 'string' && (p.type === 'anyone' || p.type === 'domain'));
  for (const grant of publicGrants) {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}/permissions/${encodeURIComponent(grant.id)}?supportsAllDrives=true`, { method:'DELETE', headers:{ Authorization:`Bearer ${token}` }, redirect:'error', signal:AbortSignal.timeout(25000) });
    // 404 = grant already gone; anything else means we could not restore the
    // private audience, so the upload must fail instead of shipping a broken URL.
    if (!response.ok && response.status !== 404) fail();
  }
}
/**
 * Bind owner-only proof metadata onto an externally-created file so only the
 * canonical retrieval path (never the raw Drive ID) can serve it later.
 */
export async function bindPrivateProof(fileId, studentId, token) {
  if (!validId(fileId) || typeof studentId !== 'string' || !studentId.trim()) fail();
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true&fields=id,appProperties`, { method:'PATCH', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }, body:JSON.stringify({ appProperties:{ umpOwner: studentId.trim().toUpperCase(), umpPurpose:'study-proof', umpSchema:PRIVATE_PROOF_PROTOCOL } }), redirect:'error', signal:AbortSignal.timeout(25000) });
  if (!response.ok || response.redirected) fail();
  const saved = await metadata(fileId, token);
  if (saved.appProperties?.umpOwner !== studentId.trim().toUpperCase() || saved.appProperties?.umpPurpose !== 'study-proof' || saved.appProperties?.umpSchema !== PRIVATE_PROOF_PROTOCOL) fail();
}
export async function checkPrivateProofDestination({folderId,principal,token}) {
  if(!validId(folderId))fail();
  const folder=await metadata(folderId,token);
  // The folder must be a real folder the principal can add children to. Direct
  // writes can still fail (service accounts carry no consumer storage quota);
  // the upload route falls back to the owner-controlled script endpoint then.
  if(folder.mimeType!=='application/vnd.google-apps.folder' || folder.capabilities?.canAddChildren!==true)fail();
  await requirePrivateAcl(folderId,token,principal);
  return {protocol:PRIVATE_PROOF_PROTOCOL,private:true,maxBytes:MAX};
}
export async function uploadPrivateProof({ studentId, fileName, mimeType, bytes, folderId, principal, token }) {
  if (!validId(folderId) || !TYPES.has(mimeType) || !bytes.byteLength || bytes.byteLength > MAX) fail();
  await checkPrivateProofDestination({folderId,principal,token});
  const boundary = `private_${crypto.randomUUID().replace(/-/g, '')}`;
  const binding = { umpOwner: studentId, umpPurpose: 'study-proof', umpSchema: PRIVATE_PROOF_PROTOCOL };
  const data = { name: fileName, parents: [folderId], appProperties: binding };
  const prefix = new TextEncoder().encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(data)}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const suffix = new TextEncoder().encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(prefix.length + bytes.byteLength + suffix.length);
  body.set(prefix); body.set(new Uint8Array(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength), prefix.length); body.set(suffix, prefix.length + bytes.byteLength);
  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id', { method:'POST', headers:{ Authorization:`Bearer ${token}`, 'Content-Type':`multipart/related; boundary=${boundary}` }, body, redirect:'error', signal:AbortSignal.timeout(120000) });
  const created = await response.json();
  if (!response.ok || response.redirected || !validId(created?.id) || created.error || created.ok === false || created.success === false) fail();
  const saved = await metadata(created.id, token);
  if (saved.appProperties?.umpOwner !== studentId || saved.appProperties?.umpPurpose !== 'study-proof' || saved.appProperties?.umpSchema !== PRIVATE_PROOF_PROTOCOL || saved.mimeType !== mimeType || Number(saved.size) !== bytes.byteLength) fail();
  await requirePrivateAcl(created.id, token, principal);
  return { success:true, fileId:created.id, proofUrl:`/api/proof-file?fileId=${encodeURIComponent(created.id)}` };
}
export async function retrievePrivateProof({ fileId, studentId, principal, token }) {
  if (!validId(fileId)) return { status:404, body:{error:'Private proof unavailable.'} };
  const file = await metadata(fileId, token);
  if (file.appProperties?.umpOwner !== studentId || file.appProperties?.umpPurpose !== 'study-proof' || file.appProperties?.umpSchema !== PRIVATE_PROOF_PROTOCOL) return { status:404, body:{error:'Private proof unavailable.'} };
  const size = Number(file.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX || !TYPES.has(file.mimeType)) fail();
  await requirePrivateAcl(fileId, token, principal);
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, options(token));
  if (!response.ok || response.redirected || !response.body) fail();
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    for (;;) { const {done,value} = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX || total > size) fail(); chunks.push(value); }
  } finally { await reader.cancel().catch(() => {}); }
  if (total !== size) fail();
  const bytes = new Uint8Array(total); let offset=0; for (const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return { status:200, bytes, headers:{ 'Content-Type':file.mimeType, 'Content-Length':String(total), 'Cache-Control':'private, no-store', 'Pragma':'no-cache', 'X-Content-Type-Options':'nosniff', 'Content-Security-Policy':'sandbox', 'Content-Disposition':'inline; filename="proof.' + ({'application/pdf':'pdf','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.mimeType]) + '"' } };
}
