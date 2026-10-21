"""Read-only compiled APK checks. Emits public build evidence, never credentials."""
import hashlib,json,os,re,subprocess,sys,xml.etree.ElementTree as ET
from pathlib import Path
A='{http://schemas.android.com/apk/res/android}'
def check_manifest(text,resources,config,runtime):
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
    assert runtime in resources,'Runtime fingerprint missing from compiled resources'
    runtime_ref=meta.get(prefix+'EXPO_RUNTIME_VERSION','')
    resource_id=re.search(r'resource\s+(0x[0-9a-f]+)\s+(?:\S+:)?string/expo_runtime_version\b',resources)
    allowed={'@string/expo_runtime_version',runtime}
    if resource_id:allowed.add('@'+resource_id.group(1))
    assert runtime_ref in allowed,'Compiled runtime metadata does not reference the verified fingerprint'
    return {'androidPackage':root.get('package'),'version':config['version'],'versionCode':config['android']['versionCode'],
        'projectId':project,'owner':config['owner'],'otaChannel':headers['expo-channel-name'],'runtimeVersion':runtime,
        'otaEnabled':True,'checkOnLaunch':'ALWAYS','embeddedBaselineEnabled':True,'antiBrickingEnabled':True,'debuggable':False}

def main():
    root=Path(__file__).resolve().parents[1];apk=Path(sys.argv[1]).resolve();sdk=Path(os.environ['ANDROID_HOME'])
    analyzer=sdk/'cmdline-tools/latest/bin/apkanalyzer'
    aapt=sdk/'build-tools/36.0.0/aapt2';signer=sdk/'build-tools/36.0.0/apksigner'
    manifest=subprocess.check_output([str(analyzer),'manifest','print',str(apk)],text=True)
    resources=subprocess.check_output([str(aapt),'dump','resources',str(apk)],text=True)
    strings=ET.parse(root/'android/app/src/main/res/values/strings.xml')
    runtime=next((n.text for n in strings.findall('string') if n.get('name')=='expo_runtime_version'),None)
    config=json.loads((root/'app.json').read_text())['expo']
    evidence=check_manifest(manifest,resources,config,runtime)
    cert_output=subprocess.check_output([str(signer),'verify','--print-certs',str(apk)],text=True)
    cert=re.search(r'Signer #1 certificate SHA-256 digest: ([a-fA-F0-9]{64})',cert_output)
    reference=json.loads((root/'released-apk-reference.json').read_text())
    assert cert and cert.group(1).lower()==reference['certificateSha256'],'APK signer does not match original release'
    evidence.update({'apkSha256':hashlib.sha256(apk.read_bytes()).hexdigest(),'apkBytes':apk.stat().st_size,
        'signingCertificateSha256':cert.group(1).lower(),'commit':os.environ.get('GITHUB_SHA'),
        'runId':os.environ.get('GITHUB_RUN_ID'),'releasePublished':False,'deviceAcceptance':'pending','backendDeployment':'not performed'})
    Path('candidate-build-evidence.json').write_text(json.dumps(evidence,indent=2)+'\n')
    print(json.dumps(evidence,indent=2))
if __name__=='__main__':main()
