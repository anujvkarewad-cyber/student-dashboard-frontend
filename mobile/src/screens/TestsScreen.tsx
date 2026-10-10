import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { useAuth } from '../context/AuthContext';
import { colors } from '../theme';

export const TestsScreen = () => {
  const { student } = useAuth();
  
  const injectJs = `
    try {
      localStorage.setItem("ump_student", JSON.stringify({
        studentId: "${student?.studentId || ''}",
        password: "${student?.password || ''}"
      }));
      window.location.hash = "tests";
    } catch(e) {}
    true;
  `;

  return (
    <View style={styles.page}>
      <WebView 
        source={{ uri: 'https://ump-dashboard.web.app/#tests' }}
        injectedJavaScriptBeforeContentLoaded={injectJs}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        renderLoading={() => (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        )}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.canvas },
  loader: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.canvas }
});
