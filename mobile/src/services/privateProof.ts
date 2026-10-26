import { config } from '../config';
import { getSavedSession, getSessionGeneration } from '../storage/session';

export type PrivateProof = { base64: string; mimeType: string; generation: number };
export function isPrivateProofLink(value: string): boolean {
  try { return new URL(value, config.gatewayOrigin || 'https://invalid.local').pathname === '/api/proof-file'; }
  catch { return value.startsWith('/api/proof-file'); }
}
export async function loadPrivateProof(value: string): Promise<PrivateProof> {
  const origin = new URL(config.gatewayOrigin);
  const url = new URL(value, origin);
  if (origin.protocol !== 'https:' || url.origin !== origin.origin || url.pathname !== '/api/proof-file' || url.username || url.password || url.hash || [...url.searchParams.keys()].some(k => k !== 'fileId') || url.searchParams.getAll('fileId').length !== 1) throw new Error('Invalid private proof link.');
  const generation = getSessionGeneration();
  const actor = await getSavedSession();
  if (!actor?.studentId || !actor.password || generation !== getSessionGeneration()) throw new Error('Sign in again to view your proof.');
  const response = await new Promise<{ mimeType: string; bytes: ArrayBuffer }>((resolve,reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET',url.toString()); xhr.responseType='arraybuffer'; xhr.timeout=60000;
    xhr.setRequestHeader('X-Student-Id',actor.studentId); xhr.setRequestHeader('X-Session-Password',actor.password);
    xhr.onprogress=e=>{if(e.loaded>10*1024*1024){xhr.abort();reject(new Error('Proof exceeds the supported size.'));}};
    xhr.onerror=xhr.ontimeout=()=>reject(new Error('Private proof could not be read.'));
    xhr.onabort=()=>reject(new Error('Proof viewing cancelled.'));
    xhr.onload=()=>{
      const mimeType=String(xhr.getResponseHeader('Content-Type')||'').split(';')[0];
      const bytes=xhr.response as ArrayBuffer;
      if(xhr.status!==200 || !['image/png','image/jpeg','image/webp','application/pdf'].includes(mimeType) || !(bytes instanceof ArrayBuffer) || !bytes.byteLength || bytes.byteLength>10*1024*1024) return reject(new Error('Private proof is unavailable for this session.'));
      resolve({mimeType,bytes});
    };
    xhr.send();
  });
  const current=await getSavedSession();
  if(generation!==getSessionGeneration() || current?.studentId!==actor.studentId || current?.password!==actor.password) throw new Error('Student session changed.');
  const bytes=new Uint8Array(response.bytes);let binary='';
  for(let i=0;i<bytes.length;i+=32768) binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return {base64:btoa(binary),mimeType:response.mimeType,generation};
}
