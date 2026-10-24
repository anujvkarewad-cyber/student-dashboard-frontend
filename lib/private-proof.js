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
  // Unknown/incomplete/inherited broader audience denies; never revoke a grant here.
  if (data.error || data.ok === false || data.success === false || data.nextPageToken || !Array.isArray(data.permissions) || !data.permissions.length || !data.permissions.every(p => p.type === 'user' && p.deleted !== true && typeof p.emailAddress === 'string' && p.emailAddress.toLowerCase() === principal.toLowerCase() && ['owner','writer','reader','organizer','fileOrganizer'].includes(p.role))) fail();
}
export async function checkPrivateProofDestination({folderId,principal,token}) {
  if(!validId(folderId))fail();
  const folder=await metadata(folderId,token);
  // Service accounts have no personal Drive storage quota. Never claim this
  // works with an arbitrary consumer-shared folder or relax its inherited ACL.
  if(folder.mimeType!=='application/vnd.google-apps.folder' || typeof folder.driveId!=='string' || !folder.driveId.trim() || folder.capabilities?.canAddChildren!==true)fail();
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
