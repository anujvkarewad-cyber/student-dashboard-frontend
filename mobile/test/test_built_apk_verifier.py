"""Synthetic regression fixtures for apkanalyzer/aapt2 output formats. No APK/keys/network."""
import copy,importlib.util,json,unittest,xml.etree.ElementTree as ET
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('apk_verifier',ROOT/'tools/verify-built-apk.py')
checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
A=checker.A
class CompiledManifestTests(unittest.TestCase):
    def setUp(self):
        self.cfg=json.loads((ROOT/'app.json').read_text())['expo']
        self.runtime='a'*40
        self.resources='resource 0x7f110080 string/expo_runtime_version\n  () (string8) "'+self.runtime+'"\nresource 0x7f110081 string/other\n  () (string8) "other"\n'
        self.root=ET.Element('manifest',{'package':self.cfg['android']['package'],A+'versionCode':str(self.cfg['android']['versionCode']),A+'versionName':self.cfg['version']})
        app=ET.SubElement(self.root,'application')
        values={'ENABLED':'true','EXPO_UPDATE_URL':'https://u.expo.dev/'+self.cfg['extra']['eas']['projectId'],
          'UPDATES_CONFIGURATION_REQUEST_HEADERS_KEY':'{"expo-channel-name":"production"}','EXPO_UPDATES_CHECK_ON_LAUNCH':'ALWAYS',
          'EXPO_UPDATES_LAUNCH_WAIT_MS':'0','EXPO_RUNTIME_VERSION':'@ref/0x7f110080'}
        for k,v in values.items():ET.SubElement(app,'meta-data',{A+'name':'expo.modules.updates.'+k,A+'value':v})
    def set_meta(self,key,value):
        node=next(n for n in self.root.findall('application/meta-data') if n.get(A+'name')=='expo.modules.updates.'+key)
        node.set(A+'value',value)
    def verify(self):
        return checker.check_manifest(ET.tostring(self.root).decode(),self.resources,self.cfg,self.runtime)
    def test_actual_apkanalyzer_numeric_resource_reference(self):
        self.assertTrue(self.verify()['otaEnabled'])
    def test_symbolic_raw_hex_and_literal_resource_forms(self):
        for value in ('@string/expo_runtime_version','@0x7f110080',self.runtime):
            with self.subTest(value=value):self.set_meta('EXPO_RUNTIME_VERSION',value);self.assertTrue(self.verify()['otaEnabled'])
    def test_sdk57_file_fingerprint_resolver(self):
        self.resources='resource 0x7f110080 string/expo_runtime_version\n () (string8) "file:fingerprint"\n'
        self.set_meta('EXPO_RUNTIME_VERSION','@7F110080')
        value=checker.check_manifest(ET.tostring(self.root).decode(),self.resources,self.cfg,self.runtime,'file:fingerprint')
        self.assertEqual(value['runtimeVersion'],self.runtime)
    def test_invalid_fingerprint_asset_rejected(self):
        self.resources='resource 0x7f110080 string/expo_runtime_version\n () (string8) "file:fingerprint"\n'
        with self.assertRaises(AssertionError):
            checker.check_manifest(ET.tostring(self.root).decode(),self.resources,self.cfg,'not-a-fingerprint','file:fingerprint')
    def test_unrecognized_file_runtime_resolver_rejected(self):
        with self.assertRaises(AssertionError):
            checker.check_manifest(ET.tostring(self.root).decode(),self.resources,self.cfg,self.runtime,'file:other')
    def test_other_resource_id_rejected(self):
        self.set_meta('EXPO_RUNTIME_VERSION','@ref/0x7f110081')
        with self.assertRaises(AssertionError):self.verify()
    def test_hash_must_be_in_runtime_resource_not_an_unrelated_string(self):
        self.resources='resource 0x7f110080 string/expo_runtime_version\n () (string8) "wrong"\nresource 0x7f110081 string/other\n () (string8) "'+self.runtime+'"'
        with self.assertRaises(AssertionError):self.verify()
    def test_unsafe_compiled_metadata_rejected(self):
        base=copy.deepcopy(self.root)
        for key,value in [('ENABLED','false'),('EXPO_UPDATE_URL','https://u.expo.dev/wrong'),('EXPO_UPDATES_CHECK_ON_LAUNCH','NEVER'),('EXPO_UPDATES_LAUNCH_WAIT_MS','5000')]:
            with self.subTest(key=key):
                self.root=copy.deepcopy(base);self.set_meta(key,value)
                with self.assertRaises(AssertionError):self.verify()
    def test_wrong_package_version_or_debug_build_rejected(self):
        base=copy.deepcopy(self.root)
        for key,value in [('package','wrong.app'),(A+'versionCode','46'),(A+'versionName','wrong')]:
            with self.subTest(key=key):
                self.root=copy.deepcopy(base);self.root.set(key,value)
                with self.assertRaises(AssertionError):self.verify()
        self.root=copy.deepcopy(base);self.root.find('application').set(A+'debuggable','true')
        with self.assertRaises(AssertionError):self.verify()
if __name__=='__main__':unittest.main()
