import assert from 'node:assert/strict';
import test from 'node:test';
import { handleProofUpload, proofConfig } from '../lib/proof-upload.js';

test('unverified Apps Script config is recognized but never enables proof upload',()=>{
 const cfg=proofConfig({APPS_SCRIPT_URL:'https://script.invalid/exec',PROOF_UPLOAD_KEY:'synthetic-only'});
 assert.equal(cfg.appsScriptConfigured,true);assert.equal(cfg.directDriveConfigured,false);assert.equal(cfg.configured,false);
});
for(const env of [{},{APPS_SCRIPT_URL:'https://script.invalid/exec',PROOF_UPLOAD_KEY:'synthetic-only'}])test('missing private storage never sends proof to a public/unknown legacy provider',async t=>{
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});let calls=0;
 globalThis.fetch=async()=>{calls++;throw Error('No provider request allowed');};
 const result=await handleProofUpload({method:'PUT',headers:{'content-type':'image/png','x-proof-protocol':'private-v1'},readBody:async()=>{throw Error('No file should be consumed');},mentorApiUrl:'https://mentor.invalid',env});
 assert.equal(result.status,503);assert.equal(calls,0);
});
for(const value of [undefined,'public-v0',''])test('old clients cannot use the new endpoint to create a public file',async()=>{
 const result=await handleProofUpload({method:'PUT',headers:{'x-proof-protocol':value},readBody:async()=>{throw Error('No file should be consumed');},env:{GOOGLE_SERVICE_ACCOUNT_EMAIL:'storage@example.invalid',GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY:'synthetic',DRIVE_PROOF_FOLDER_ID:'private_folder'}});
 assert.equal(result.status,409);assert.notEqual(result.body.success,true);
});
// Provider ACK, owner binding, public/inherited ACL denial and positive new-file
// upload/retrieval now run through the real private implementation in private-proof.test.mjs.
