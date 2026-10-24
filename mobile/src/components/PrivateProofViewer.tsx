import React, { useRef } from 'react';
import { Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import { getSessionGeneration } from '../storage/session';
import { PDF_VIEWER_HTML } from '../services/pdfViewerBundle';
import type { PrivateProof } from '../services/privateProof';
import { colors } from '../theme';
// Disable dynamic PDF font evaluation for untrusted uploaded documents.
const SAFE_PROOF_PDF_HTML = PDF_VIEWER_HTML.replace('getDocument({data:arr})', 'getDocument({data:arr,isEvalSupported:false})');
const NativeWebView: any = Platform.OS === 'web' ? null : require('react-native-webview').WebView;
export function PrivateProofViewer({ proof, onClose }: { proof: PrivateProof | null; onClose: () => void }) {
  const viewer=useRef<any>(null);
  const fed=useRef<PrivateProof|null>(null);
  const feed=async()=>{
    const web=viewer.current;
    if(!proof || !web || fed.current===proof || proof.generation!==getSessionGeneration()) return;
    fed.current=proof;
    for(let i=0;i<proof.base64.length;i+=262144){
      if(viewer.current!==web || proof.generation!==getSessionGeneration()) return;
      web.injectJavaScript(`window.__pushChunk(${JSON.stringify(proof.base64.slice(i,i+262144))});true;`);
    }
    if(viewer.current===web && proof.generation===getSessionGeneration())web.injectJavaScript('window.__render();true;');
  };
  const valid=proof && proof.generation===getSessionGeneration();
  return <Modal visible={Boolean(valid)} onRequestClose={onClose} animationType="slide">
    <View style={{flex:1,backgroundColor:colors.surface,paddingTop:32}}>
      <Pressable accessibilityRole="button" onPress={onClose} style={{padding:18}}><Text style={{color:colors.primary}}>Close private proof</Text></Pressable>
      {valid && proof.mimeType!=='application/pdf' ? <Image source={{uri:`data:${proof.mimeType};base64,${proof.base64}`}} style={{flex:1}} resizeMode="contain"/> : null}
      {valid && proof.mimeType==='application/pdf' && NativeWebView ? <NativeWebView ref={viewer} source={{html:SAFE_PROOF_PDF_HTML}} originWhitelist={['about:blank']} onShouldStartLoadWithRequest={(r:{url:string})=>r.url==='about:blank'} javaScriptEnabled setSupportMultipleWindows={false} onLoadEnd={()=>void feed()} style={{flex:1}}/> : null}
      {valid && proof.mimeType==='application/pdf' && Platform.OS==='web' ? React.createElement('iframe',{src:`data:application/pdf;base64,${proof.base64}`,sandbox:'',title:'Private study proof',style:{flex:1,border:0}}) : null}
    </View>
  </Modal>;
}
