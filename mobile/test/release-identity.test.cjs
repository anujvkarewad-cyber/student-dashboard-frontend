const test=require('node:test');const assert=require('node:assert/strict');
const {assertReleaseIdentity}=require('../tools/check-release-identity.cjs');
const app=require('../app.json').expo,ref=require('../released-apk-reference.json');
test('reference records the public release and app identity matches it',()=>{
 assert.equal(ref.androidPackage,'com.ujjwalpathak.mentorship');assert.equal(app.android.package,ref.androidPackage);
 assert.equal(ref.version,'1.16.0');assert.equal(ref.versionCode,50);
 assert.equal(app.version,ref.version);assert.equal(app.android.versionCode,ref.versionCode);
});
test('current tree cannot be rebuilt without a version bump',()=>{
 assert.throws(()=>assertReleaseIdentity(app,ref,ref.certificateSha256),/versionCode/);
});
test('next candidate (code 51) passes with the original signing certificate',()=>{
 const candidate={...app,android:{...app.android,versionCode:ref.versionCode+1}};
 assert.doesNotThrow(()=>assertReleaseIdentity(candidate,ref,ref.certificateSha256));
});
test('replacement/debug or missing signing certificate cannot pass',()=>{
 const candidate={...app,android:{...app.android,versionCode:ref.versionCode+1}};
 for(const cert of ['', '0'.repeat(64),'invalid']) assert.throws(()=>assertReleaseIdentity(candidate,ref,cert),/Signing certificate/);
});
test('same/older version code cannot be built as an upgrade',()=>{
 for(const code of [46,49,50]) assert.throws(()=>assertReleaseIdentity({...app,android:{...app.android,versionCode:code}},ref,ref.certificateSha256),/versionCode/);
});
test('changed application id cannot silently bypass in-place upgrade',()=>{
 const candidate={...app,android:{...app.android,versionCode:ref.versionCode+1,package:'other.app'}};
 assert.throws(()=>assertReleaseIdentity(candidate,ref,ref.certificateSha256),/application ID/);
});
test('next candidate upgrades every installed public and test build',()=>{
 const candidate={...app,android:{...app.android,versionCode:ref.versionCode+1}};
 assert.doesNotThrow(()=>assertReleaseIdentity(candidate,{...ref,versionCode:46},ref.certificateSha256));
 assert.doesNotThrow(()=>assertReleaseIdentity(candidate,{...ref,versionCode:50},ref.certificateSha256));
});
