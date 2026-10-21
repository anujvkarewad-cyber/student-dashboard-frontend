import { Ionicons } from '@expo/vector-icons';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Chip, FormInput, PrimaryButton } from '../components/ui';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useData } from '../context/DataContext';
import { getSavedSession } from '../storage/session';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';
import type { StudyLogPayload } from '../types';

type Props = NativeStackScreenProps<RootStackParamList, 'AddStudyLog'>;
type Planned = StudyLogPayload['studiedAsPlanned'] | '';

type PickedProof = { uri: string; name: string; mimeType: string; size: number };

const subjectsList = ['Accounts', 'Law', 'Taxation', 'Costing', 'Audit', 'FM', 'SM', 'Revision', 'Mock Test', 'Question Bank Practice'];
const reasons = ['Health Issue', 'Family Function', 'Office / Job', 'College', 'Travelling', 'Power / Internet Issue', 'Personal Work', 'Low Motivation', 'Other'];
const supportOptions = ['No', 'Subject Doubt', 'Time Management', 'Motivation', 'Study Planning', 'Personal Discussion'];
// Cloud Run accepts the original binary and enforces the same limit/type list.
// Keep this in sync with lib/proof-upload.js.
const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const PROOF_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const proofMimeType = (name: string, reported?: string | null) => {
  const mime = String(reported || '').split(';')[0].toLowerCase();
  if (PROOF_MIME_TYPES.includes(mime)) return mime;
  const extension = name.toLowerCase().split('.').pop();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  if (extension === 'pdf') return 'application/pdf';
  return '';
};
const safeCacheName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'proof';
const localDateKey = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

const Field = ({ title, required = false, children }: React.PropsWithChildren<{ title: string; required?: boolean }>) => (
  <View style={styles.field}>
    <Text style={styles.fieldTitle}>{title}{required ? <Text style={styles.required}> *</Text> : null}</Text>
    {children}
  </View>
);

const ChipList = ({ values, selected, toggle }: { values: string[]; selected: string[]; toggle: (value: string) => void }) => (
  <View style={styles.chips}>{values.map((value) => <Chip key={value} label={value} selected={selected.includes(value)} onPress={() => toggle(value)} />)}</View>
);

export const AddStudyLogScreen = ({ navigation }: Props) => {
  const { backendMode } = useAuth();
  const { submitStudyLog } = useData();
  const [date, setDate] = useState(localDateKey());
  const [hours, setHours] = useState('');
  const [planned, setPlanned] = useState<Planned>('');
  const [reason, setReason] = useState('');
  const [otherReason, setOtherReason] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [targetCompleted, setTargetCompleted] = useState('');
  const [tomorrowTarget, setTomorrowTarget] = useState('');
  const [mentorSupport, setMentorSupport] = useState('');
  const [proof, setProof] = useState<PickedProof | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const chooseProof = async () => {
    setError('');
    try {
      const result = await DocumentPicker.getDocumentAsync({
        // Do not offer HEIC or provider-specific image formats that the server
        // cannot safely display. Old Android providers often misreport MIME,
        // so the extension is checked below as a fallback.
        type: PROOF_MIME_TYPES,
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const mimeType = proofMimeType(asset.name, asset.mimeType);
      if (!mimeType) {
        setProof(null);
        setError('Choose a JPEG, PNG, WebP or PDF proof file.');
        return;
      }

      // Most devices already return a file:// cache copy. A few old Android
      // document providers return content:// even when copying was requested;
      // copy that stream into our cache before validating it.
      let uri = asset.uri;
      if (!uri.startsWith('file://')) {
        if (!FileSystem.cacheDirectory) throw new Error('App cache is unavailable on this phone.');
        const destination = `${FileSystem.cacheDirectory}proof-${Date.now()}-${safeCacheName(asset.name)}`;
        await FileSystem.copyAsync({ from: uri, to: destination });
        uri = destination;
      }

      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) throw new Error('The selected proof could not be read. Choose it again from Downloads or Gallery.');
      const size = Number(('size' in info && info.size) || asset.size || 0);
      if (size > MAX_PROOF_BYTES) {
        setProof(null);
        setError('Study proof must be 10 MB or smaller.');
        return;
      }
      if (size <= 0) throw new Error('The selected proof is empty or unreadable. Choose another file.');
      setProof({ uri, name: asset.name, mimeType, size });
    } catch (error) {
      setProof(null);
      setError(error instanceof Error ? error.message : 'Could not read this proof file. Choose it again.');
    }
  };

  const toggleSubject = (value: string) => {
    setSubjects((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  };

  const validate = () => {
    const hoursRaw = hours.trim().replace(',', '.');
    const parsedHours = Number(hoursRaw);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) return 'Enter a valid date in YYYY-MM-DD format.';
    if (!hoursRaw) return 'Enter study hours. Enter 0 if you could not study today.';
    if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(hoursRaw) || !Number.isFinite(parsedHours) || parsedHours < 0 || parsedHours > 24) return 'Study hours must be a number between 0 and 24.';
    if (parsedHours === 0 && planned !== 'No') return 'For 0 hours, select No under studied as planned and choose a reason.';
    if (!planned) return 'Select whether you studied as planned.';
    if (planned === 'No' && !reason) return 'Select the main reason you could not study as planned.';
    if (planned === 'No' && reason === 'Other' && !otherReason.trim()) return 'Please specify the reason.';
    if (planned !== 'No' && !subjects.length) return 'Select at least one subject.';
    if (planned !== 'No' && !targetCompleted) return 'Select whether today’s target was completed.';
    if (planned !== 'No' && !proof) return 'Attach today’s study proof (photo or PDF).';
    return '';
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setLoading(true);
    try {
      let proofUrl = '';
      if (proof && planned !== 'No') {
        const saved = await getSavedSession();
        if (!saved) throw new Error('Your saved session expired. Sign in again before uploading proof.');
        const uploaded = await api.uploadProof({
          studentId: saved.studentId,
          password: saved.password,
          fileName: proof.name,
          mimeType: proof.mimeType,
          fileUri: proof.uri,
        });
        proofUrl = uploaded.proofUrl;
      }
      await submitStudyLog({
        date,
        hours: Number(hours.trim().replace(',', '.')),
        studiedAsPlanned: planned as StudyLogPayload['studiedAsPlanned'],
        reason: planned === 'No' ? (reason === 'Other' ? otherReason.trim() : reason) : '',
        subjects: planned === 'No' ? '' : subjects.join(', '),
        targetCompleted: planned === 'No' ? '' : targetCompleted,
        tomorrowTarget: planned === 'No' ? '' : tomorrowTarget.trim(),
        mentorSupport,
        proofUrl,
      });
      Alert.alert('Study log saved', 'Your progress has been added successfully.', [{ text: 'Done', onPress: () => navigation.goBack() }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the study log.');
    } finally { setLoading(false); }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.intro}>
            <View style={styles.introIcon}><Ionicons name="sparkles" size={24} color={colors.primary} /></View>
            <View style={styles.introBody}><Text style={styles.introTitle}>Show up for yourself</Text><Text style={styles.introText}>A quick daily check-in keeps your plan visible and your mentor informed.</Text></View>
          </View>
          {backendMode === 'live' ? <View style={styles.liveBanner}><Ionicons name="cloud-upload-outline" size={18} color={colors.success} /><Text style={styles.liveBannerText}>Full live sync is on. This entry and its proof will be submitted to your existing mentorship dashboard.</Text></View> : null}

          <FormInput label="Study date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
          <FormInput label="Total study hours" value={hours} onChangeText={setHours} placeholder="0 if no study, e.g. 5.5 otherwise" keyboardType="decimal-pad" />
          <View style={styles.field}>
            <View style={styles.chips}>
              <Chip label="Aaj padhai nahi hui (0 hrs)" selected={hours.trim() !== '' && Number(hours.replace(',', '.')) === 0 && planned === 'No'} onPress={() => {
                setHours('0');
                setPlanned('No');
                setSubjects([]);
                setTargetCompleted('');
                setTomorrowTarget('');
                setProof(null);
                setError('');
              }} />
            </View>
            <Text style={styles.introText}>0 hours is an honest tracker submission, not an Absent or Leave request. Choose a reason below; study proof is not needed.</Text>
          </View>

          <Field title="Were you able to study as planned?" required>
            <View style={styles.chips}>{['Yes', 'No', 'Maybe'].map((value) => <Chip key={value} label={value} selected={planned === value} onPress={() => { setPlanned(value as Planned); setError(''); }} />)}</View>
          </Field>

          {planned === 'No' ? (
            <Field title="What was the main reason?" required>
              <ChipList values={reasons} selected={reason ? [reason] : []} toggle={setReason} />
              {reason === 'Other' ? <FormInput label="Please specify" value={otherReason} onChangeText={setOtherReason} placeholder="Tell your mentor briefly" style={styles.topGap} /> : null}
            </Field>
          ) : null}

          {planned === 'Yes' || planned === 'Maybe' ? (
            <>
              <Field title="Which subjects did you study?" required>
                <ChipList values={subjectsList} selected={subjects} toggle={toggleSubject} />
              </Field>
              <Field title="Did you complete today's target?" required>
                <View style={styles.chips}>{['Yes', 'No', 'Maybe'].map((value) => <Chip key={value} label={value} selected={targetCompleted === value} onPress={() => setTargetCompleted(value)} />)}</View>
              </Field>
              <Field title="Study proof" required>
                <Pressable onPress={chooseProof} style={[styles.upload, proof && styles.uploadSelected]}>
                  <View style={styles.uploadIcon}><Ionicons name={proof ? 'checkmark' : 'cloud-upload-outline'} size={24} color={proof ? colors.success : colors.primary} /></View>
                  <View style={styles.uploadBody}>
                    <Text style={styles.uploadTitle} numberOfLines={1}>{proof?.name || 'Choose a photo or PDF'}</Text>
                    <Text style={styles.uploadText}>{proof ? `${(proof.size / 1024 / 1024).toFixed(2)} MB selected` : 'Maximum file size: 10 MB'}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={19} color={colors.muted} />
                </Pressable>
              </Field>
              <FormInput label="Tomorrow's target (optional)" value={tomorrowTarget} onChangeText={setTomorrowTarget} placeholder="e.g. Finish Chapter 4" />
            </>
          ) : null}

          <Field title="Do you need mentor support?">
            <ChipList values={supportOptions} selected={mentorSupport ? [mentorSupport] : []} toggle={(value) => setMentorSupport(mentorSupport === value ? '' : value)} />
          </Field>

          {error ? <View style={styles.error}><Ionicons name="alert-circle" size={20} color={colors.red} /><Text style={styles.errorText}>{error}</Text></View> : null}
          <PrimaryButton label="Submit to mentorship" icon="checkmark-circle-outline" onPress={submit} loading={loading} />
          <Text style={styles.privacy}>Your entry is shared only with your mentorship team.</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: 50, gap: spacing.xl },
  intro: { backgroundColor: colors.primarySoft, borderRadius: radius.lg, padding: spacing.lg, flexDirection: 'row', gap: spacing.md, borderWidth: 1, borderColor: '#D7E0FF' },
  introIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  introBody: { flex: 1 },
  introTitle: { color: colors.ink, fontSize: 15, fontWeight: '900' },
  introText: { color: colors.inkSoft, fontSize: 12, lineHeight: 18, marginTop: 4 },
  liveBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.tealSoft, borderRadius: radius.md, borderWidth: 1, borderColor: '#BFE5DB', padding: spacing.md },
  liveBannerText: { flex: 1, color: colors.inkSoft, fontSize: 10, lineHeight: 15 },
  field: { gap: spacing.md },
  fieldTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '800' },
  required: { color: colors.red },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  topGap: { marginTop: spacing.sm },
  upload: { minHeight: 76, borderRadius: radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B9C8F5', backgroundColor: '#F8FAFF', padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  uploadSelected: { borderColor: colors.success, backgroundColor: colors.tealSoft },
  uploadIcon: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  uploadBody: { flex: 1 },
  uploadTitle: { color: colors.ink, fontSize: 13, fontWeight: '800' },
  uploadText: { color: colors.muted, fontSize: 10, marginTop: 4 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.redSoft, borderRadius: radius.md },
  errorText: { color: colors.red, fontSize: 13, lineHeight: 18, flex: 1, fontWeight: '600' },
  privacy: { color: colors.muted, fontSize: 10, textAlign: 'center' },
});
