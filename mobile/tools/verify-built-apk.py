"""Read-only compiled APK checks. Emits public build evidence, never credentials."""
import hashlib,json,os,re,shutil,subprocess,sys,zipfile,xml.etree.ElementTree as ET
from pathlib import Path
A='{http://schemas.android.com/apk/res/android}'
def check_manifest(text,resources,config,runtime,runtime_spec=None):
    root=ET.fromstring(text)
    assert root.get('package')==config['android']['package'],'Compiled package mismatch'
    assert int(root.get(A+'versionCode'))==config['android']['versionCode'],'Compiled versionCode mismatch'
    assert root.get(A+'versionName')==config['version'],'Compiled version mismatch'
    app=root.find('application');assert app is not None
    assert app.get(A+'debuggable','false')=='false','Debuggable APK refused'
    meta={n.get(A+'name'):n.get(A+'value') for n in app.findall('meta-data')}
    prefix='expo.modules.updates.'
    assert meta.get(prefix+'ENABLED')=='true','OTA absent/disabled in compiled APK'
    project=config['extra']['eas']['projectId']
    assert meta.get(prefix+'EXPO_UPDATE_URL')=='https://u.expo.dev/'+project,'Compiled OTA project mismatch'
    headers=json.loads(meta[prefix+'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY'])
    assert headers.get('expo-channel-name')==os.environ.get('UPM_OTA_CHANNEL','production'),'Compiled channel mismatch'
    assert meta.get(prefix+'EXPO_UPDATES_CHECK_ON_LAUNCH')=='ALWAYS','Launch check disabled'
    assert meta.get(prefix+'EXPO_UPDATES_LAUNCH_WAIT_MS')=='0','Unexpected blocking launch delay'
    assert meta.get(prefix+'HAS_EMBEDDED_UPDATE','true')=='true','Embedded baseline disabled'
    assert meta.get(prefix+'DISABLE_ANTI_BRICKING_MEASURES','false')=='false','Anti-bricking disabled'
    assert re.fullmatch('[a-f0-9]{40,64}',runtime or ''),'Missing fingerprint runtime'
    runtime_spec=runtime_spec or runtime
    assert runtime_spec==runtime or runtime_spec=='file:fingerprint','Unsupported SDK runtime resolver'
    assert runtime_spec in resources,'Runtime resolver missing from compiled resources'
    runtime_ref=meta.get(prefix+'EXPO_RUNTIME_VERSION','')
    resource_id=re.search(r'resource\s+(0x[0-9a-f]+)\s+(?:\S+:)?string/expo_runtime_version\b([^\n]*\n.*?)(?=\n\s*resource\s|\Z)',resources,re.S)
    assert resource_id and runtime_spec in resource_id.group(2),'Runtime resolver not in its compiled resource'
    allowed={'@string/expo_runtime_version',runtime_spec,'@'+resource_id.group(1),'@ref/'+resource_id.group(1),'@'+resource_id.group(1)[2:].upper()}
    assert runtime_ref in allowed,'Compiled runtime metadata does not reference the verified fingerprint'
    return {'androidPackage':root.get('package'),'version':config['version'],'versionCode':config['android']['versionCode'],
        'projectId':project,'owner':config['owner'],'otaChannel':headers['expo-channel-name'],'runtimeVersion':runtime,
        'otaEnabled':True,'checkOnLaunch':'ALWAYS','embeddedBaselineEnabled':True,'antiBrickingEnabled':True,'debuggable':False}

def require_runtime_alignment(expected, actual):
    assert expected and re.fullmatch('[a-f0-9]{40,64}', expected), 'Missing or invalid prebuild runtime evidence'
    assert expected == actual, 'Clean-source/compiled OTA runtime mismatch: owner candidate is NOT FOR INSTALL'

def main():
    # Parse Android's binary XML directly. apkanalyzer's human-readable output
    # can contain unescaped JSON attribute quotes and is not always valid XML.
    from loguru import logger
    logger.remove()
    from androguard.core.apk import APK
    from lxml import etree
    root=Path(__file__).resolve().parents[1];path=Path(sys.argv[1]).resolve()
    parsed=APK(str(path));manifest=parsed.get_android_manifest_xml()
    config=json.loads((root/'app.json').read_text())['expo']
    arsc=parsed.get_android_resources()
    meta={n.get(A+'name'):n.get(A+'value') for n in manifest.findall('application/meta-data')}
    ref=meta['expo.modules.updates.EXPO_RUNTIME_VERSION']
    assert re.fullmatch(r'@(?:0x)?[A-Fa-f0-9]{8}',ref),'Unexpected binary runtime reference'
    rid=int(ref[1:],16)
    resolved={v for _,v in arsc.get_resolved_res_configs(rid)}
    assert arsc.get_res_id_by_key(parsed.get_package(),'string','expo_runtime_version')==rid,'Runtime resource name/id mismatch'
    assert len(resolved)==1,'Ambiguous localized runtime versions'
    runtime_spec=next(iter(resolved))
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None,'APK ZIP CRC failure'
        runtime=z.read('assets/fingerprint').decode().strip() if runtime_spec=='file:fingerprint' else runtime_spec
        embedded=json.loads(z.read('assets/app.config'))
        assert embedded['extra']['eas']['projectId']==config['extra']['eas']['projectId'],'Bundled Expo project mismatch'
        assert embedded['owner']==config['owner'] and embedded['slug']==config['slug'],'Bundled owner/slug mismatch'
        assert embedded['version']==config['version'],'Bundled app version mismatch'
        assert 'assets/app.manifest' in z.namelist() and 'assets/index.android.bundle' in z.namelist(),'Embedded offline baseline missing'
        abis=sorted({n.split('/')[1] for n in z.namelist() if n.startswith('lib/') and n.endswith('.so')})
        assert abis==['arm64-v8a','armeabi-v7a'],'Original ARM ABI coverage changed'
    # Resource metadata is decoded from the ARSC table, not inferred from source.
    resources=f'resource {hex(rid)} string/expo_runtime_version\n () (string8) "{runtime_spec}"\n'
    evidence=check_manifest(etree.tostring(manifest,encoding='utf-8').decode(),resources,config,runtime,runtime_spec)
    signer=shutil.which('apksigner')
    if not signer:
        sdk=Path(os.environ['ANDROID_HOME']);signer=str(sdk/'build-tools/36.0.0/apksigner')
    cert_output=subprocess.check_output([signer,'verify','--print-certs',str(path)],text=True)
    cert=re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})',cert_output)
    reference=json.loads((root/'released-apk-reference.json').read_text())
    assert cert and cert.group(1).lower()==reference['certificateSha256'],'APK signer does not match original release'
    digest=hashlib.sha256(path.read_bytes()).hexdigest()
    if os.environ.get('EXPECTED_APK_SHA256'):assert digest==os.environ['EXPECTED_APK_SHA256'],'Pinned compiled APK bytes changed'
    preflight=os.environ.get('UPM_PREFLIGHT_RUNTIME')
    evidence.update({'apkSha256':digest,'apkBytes':path.stat().st_size,'abis':abis,
        'signingCertificateSha256':cert.group(1).lower(),'commit':os.environ.get('UPM_COMPILED_COMMIT',os.environ.get('GITHUB_SHA')),
        'verificationCommit':os.environ.get('GITHUB_SHA'),'buildRunId':os.environ.get('UPM_COMPILED_RUN_ID'),
        'verificationRunId':os.environ.get('GITHUB_RUN_ID'),'runtimeResourceValue':runtime_spec,
        'prebuildRuntimeVersion':preflight,'prebuildRuntimeMatchesCompiled':preflight==runtime if preflight else None,
        'releasePublished':False,'deviceAcceptance':'pending','backendDeployment':'not performed',
        'otaPublicationReady':False,'releaseGate':'Owner-only candidate. Resolve prebuild/native fingerprint drift and device/OTA/backend acceptance before publication.'})
    Path('candidate-build-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    require_runtime_alignment(preflight, runtime)
    print(json.dumps(evidence,indent=2))
if __name__=='__main__':main()
