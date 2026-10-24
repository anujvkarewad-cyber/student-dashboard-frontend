const test=require('node:test');const assert=require('node:assert/strict');
const {assertReleaseIdentity}=require('../tools/check-release-identity.cjs');
const app=require('../app.json').expo,ref=require('../released-apk-reference.json');
test('candidate identity matches current application and increases release code',()=>{
 assert.equal(app.android.package,'com.ujjwalpathak.mentorship');assert.equal(ref.versionCode,46);
 assert.equal(app.android.versionCode,49);assert.doesNotThrow(()=>assertReleaseIdentity(app,ref,ref.certificateSha256));
});
test('replacement/debug or missing signing certificate cannot pass',()=>{
 for(const cert of ['', '0'.repeat(64),'invalid']) assert.throws(()=>assertReleaseIdentity(app,ref,cert),/Signing certificate/);
});
test('same/older version code cannot be built as an upgrade',()=>{
 for(const code of [45,46]) assert.throws(()=>assertReleaseIdentity({...app,android:{...app.android,versionCode:code}},ref,ref.certificateSha256),/versionCode/);
});
test('changed application id cannot silently bypass in-place upgrade',()=>{
 assert.throws(()=>assertReleaseIdentity({...app,android:{...app.android,package:'other.app'}},ref,ref.certificateSha256),/application ID/);
});

test('recorder-fix candidate upgrades both public46 and owner-test47',()=>{
 assert.equal(app.version,'1.15.4');assert.ok(app.android.versionCode>47);
 assert.doesNotThrow(()=>assertReleaseIdentity(app,{...ref,versionCode:47},ref.certificateSha256));
});
