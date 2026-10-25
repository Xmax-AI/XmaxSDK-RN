import { useLocalization } from '../localization/LocalizationProvider';
import { useEffect, useState, type ComponentProps } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { XmaxSDKInfo, type XmaxEnvironment } from '@xmaxai/react-native-sdk';
import Clipboard from '@react-native-clipboard/clipboard';
import Video from 'react-native-video';
import { useStorage, formatFileSize } from '../storage/useStorage';

const orange = '#F5B86C';

const font = (size: number) => size * 1.15;

function Label({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} style={[styles.text, style]} />;
}

/**
 * Presents file selection, local preview and storage transfer results.
 *
 * The storage hook owns uploads and temporary files. Video preview pauses
 * while the application is not active.
 */
export function StorageScreen({
  onBack,
  apiKey,
  environment,
}: {
  onBack: () => void;
  apiKey: string;
  environment: XmaxEnvironment;
}) {
  const { t } = useLocalization();
  const storage = useStorage(apiKey, environment);
  const { file, busy, result, progress, error, safe } = storage;
  const [copied, setCopied] = useState(false);
  const [foreground, setForeground] = useState(
    AppState.currentState === 'active',
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', state =>
      setForeground(state === 'active'),
    );

    return () => sub.remove();
  }, []);

  useEffect(() => setCopied(false), [result]);

  const fraction = progress?.fractionCompleted ?? 0;

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.primaryGlow} />
      <View pointerEvents="none" style={styles.secondaryGlow} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('common.home')}
            style={styles.back}
            onPress={onBack}
          >
            <Image
              source={require('../assets/realtime/realtime_nav_back.png')}
              style={styles.backIcon}
            />
          </Pressable>
          <View style={styles.topTitles}>
            <Label style={styles.pageTitle}>{t('feed.storage.title')}</Label>
            <Label style={styles.platform}>{t('storage.platform')}</Label>
          </View>
          <View style={styles.version}>
            <Label style={styles.versionText}>v{XmaxSDKInfo.version}</Label>
          </View>
        </View>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.content}
        >
          <View style={[styles.card, styles.overview]}>
            <View style={styles.row}>
              <View style={styles.eyebrowRow}>
                <View style={styles.dot} />
                <Label style={styles.eyebrow}>{t('storage.pipeline')}</Label>
              </View>
              <View style={styles.ready}>
                <Label style={styles.readyText}>{t('feed.ready')}</Label>
              </View>
            </View>
            <Label style={styles.overviewTitle}>
              {t('storage.hero.title')}
            </Label>
            <Label style={styles.overviewSubtitle}>
              {t('storage.hero.subtitle')}
            </Label>
            <View style={styles.pipeline}>
              <Label style={styles.pipelineLabel}>
                {t('storage.localFile')}
              </Label>
              <Label style={styles.separator}>—</Label>
              <Label style={[styles.pipelineLabel, styles.accent]}>
                XMAX SDK
              </Label>
              <Label style={styles.separator}>—</Label>
              <Label style={styles.pipelineLabel}>
                {t('storage.remoteURL')}
              </Label>
            </View>
          </View>
          <View style={styles.card}>
            <View style={styles.fileHeader}>
              <View style={styles.step}>
                <Label style={styles.stepText}>01</Label>
              </View>
              <Label style={styles.sectionTitle}>{t('storage.preview')}</Label>
              <View style={styles.flex} />
              {file && (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={storage.pick}
                  style={[
                    styles.compactButton,
                    busy !== null && styles.disabled,
                  ]}
                >
                  <Label style={styles.compactText}>
                    {t('storage.reselect')}
                  </Label>
                </Pressable>
              )}
            </View>
            {file?.kind === 'video' && (
              <Label style={styles.videoHint}>
                {t('storage.safety.unsupported')}
              </Label>
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('storage.select')}
              disabled={busy !== null || file !== null}
              onPress={storage.pick}
              style={styles.picker}
            >
              {file ? (
                file.kind === 'image' ? (
                  <Image
                    source={{ uri: file.fileURL }}
                    resizeMode="contain"
                    style={styles.preview}
                  />
                ) : (
                  <Video
                    source={{ uri: file.fileURL }}
                    style={styles.preview}
                    resizeMode="contain"
                    repeat
                    muted
                    paused={!foreground}
                    playInBackground={false}
                  />
                )
              ) : (
                <>
                  <View style={styles.plusCircle}>
                    {busy === 'picking' ? (
                      <ActivityIndicator color={orange} />
                    ) : (
                      <Label style={styles.plus}>＋</Label>
                    )}
                  </View>
                  <Label style={styles.pickerTitle}>
                    {busy === 'picking'
                      ? t('storage.reading')
                      : t('storage.select.hint')}
                  </Label>
                  <Label style={styles.pickerType}>
                    {t('storage.mediaTypes')}
                  </Label>
                </>
              )}
            </Pressable>
            <View style={styles.metadata}>
              {[
                [
                  t('storage.type'),
                  file
                    ? file.kind === 'image'
                      ? t('storage.image')
                      : t('storage.video')
                    : '--',
                ],
                [
                  t('storage.resolution'),
                  file?.width && file.height
                    ? `${file.width} × ${file.height}`
                    : '--',
                ],
                [
                  t('storage.size'),
                  file ? formatFileSize(file.byteCount) : '--',
                ],
              ].map(([label, value]) => (
                <View style={styles.metric} key={label}>
                  <Label style={styles.metricLabel}>{label}</Label>
                  <Label
                    style={styles.metricValue}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.72}
                  >
                    {value}
                  </Label>
                </View>
              ))}
            </View>
            {busy === 'uploading' && (
              <>
                <View style={styles.row}>
                  <Label style={styles.progressText}>
                    {fraction >= 1
                      ? t('storage.processing')
                      : t('storage.upload.progress', {
                          percent: Math.round(fraction * 100),
                        })}
                  </Label>
                  <Label style={styles.modeText}>
                    {t(
                      file?.kind === 'video'
                        ? 'storage.upload.video'
                        : safe
                        ? 'storage.upload.safety'
                        : 'storage.upload.image',
                    )}
                  </Label>
                </View>
                <View
                  accessibilityRole="progressbar"
                  accessibilityValue={{
                    min: 0,
                    max: 100,
                    now: Math.round(fraction * 100),
                  }}
                  style={styles.progressTrack}
                >
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${fraction * 100}%` },
                    ]}
                  />
                </View>
              </>
            )}
            {file && (
              <View style={styles.actions}>
                {file.kind === 'image' && (
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy !== null}
                    onPress={() => storage.upload(true)}
                    style={[
                      styles.button,
                      styles.actionButton,
                      busy !== null && styles.disabled,
                    ]}
                  >
                    <Label style={styles.buttonText}>
                      {t(
                        busy === 'uploading' && safe
                          ? 'storage.upload.checking'
                          : 'storage.upload.safe',
                      )}
                    </Label>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy !== null}
                  onPress={() => storage.upload(false)}
                  style={[
                    styles.button,
                    styles.actionButton,
                    busy !== null && styles.disabled,
                  ]}
                >
                  <Label style={styles.buttonText}>
                    {t(
                      busy === 'uploading' && !safe
                        ? 'storage.uploading'
                        : file.kind === 'image'
                        ? 'storage.upload.normal'
                        : 'storage.upload.getURL',
                    )}
                  </Label>
                </Pressable>
              </View>
            )}
          </View>
          {error && (
            <View accessibilityRole="alert" style={styles.errorBox}>
              <Label selectable style={styles.errorText}>
                {'message' in error ? error.message : t(error.messageKey)}
              </Label>
            </View>
          )}
          {result && (
            <View style={[styles.card, styles.result]}>
              <View style={styles.fileHeader}>
                <View style={styles.step}>
                  <Label style={styles.stepText}>02</Label>
                </View>
                <Label style={styles.sectionTitle}>{t('storage.result')}</Label>
                <View style={styles.flex} />
                <View style={styles.compactButton}>
                  <Label style={styles.compactText}>
                    {t('storage.success')}
                  </Label>
                </View>
              </View>
              <View style={styles.elapsedRow}>
                <Label style={styles.elapsedLabel}>
                  {t('storage.elapsed')}
                </Label>
                <Label style={styles.elapsedValue}>
                  {result.elapsed < 1000
                    ? `${result.elapsed} ms`
                    : `${(result.elapsed / 1000).toFixed(2)} s`}
                </Label>
              </View>
              <Label style={styles.urlLabel}>{t('storage.remoteURL')}</Label>
              <View style={styles.urlBox}>
                <Label selectable style={styles.url}>
                  {result.file.url}
                </Label>
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Clipboard.setString(result.file.url);
                  setCopied(true);
                }}
                style={styles.button}
              >
                <Label style={styles.buttonText}>
                  {copied ? t('storage.copied') : t('storage.copy')}
                </Label>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  compactButton: {
    height: 26,
    paddingHorizontal: 8,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.28)',
    backgroundColor: 'rgba(245,184,108,0.08)',
    justifyContent: 'center',
  },
  compactText: { fontSize: font(8), fontWeight: '700', color: orange },
  disabled: { opacity: 0.45 },
  videoHint: { fontSize: font(9), color: '#596678', marginBottom: 10 },
  preview: { width: '100%', height: '100%' },
  progressText: { fontSize: font(10), color: orange },
  modeText: { fontSize: font(9), color: '#657386' },
  progressTrack: {
    height: 5,
    borderRadius: 2.5,
    overflow: 'hidden',
    backgroundColor: 'rgba(245,184,108,0.14)',
    marginTop: 7,
    marginBottom: 16,
  },
  progressFill: { height: '100%', backgroundColor: orange },
  actions: { flexDirection: 'row', gap: 10 },
  actionButton: { flex: 1 },
  button: {
    flexGrow: 1,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.28)',
    backgroundColor: 'rgba(245,184,108,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: font(11), fontWeight: '700', color: orange },
  errorBox: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(255,107,114,0.22)',
    backgroundColor: 'rgba(255,95,104,0.16)',
  },
  errorText: { fontSize: 10, color: '#FFB5B5' },
  result: { borderColor: 'rgba(245,184,108,0.35)' },
  elapsedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
    marginBottom: 14,
  },
  elapsedLabel: { fontSize: font(11), color: '#718095' },
  elapsedValue: { fontSize: font(10), fontWeight: '700', color: orange },
  urlLabel: {
    fontSize: font(9),
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#667589',
    marginBottom: 7,
  },
  urlBox: {
    minHeight: 58,
    padding: 10,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.13)',
    backgroundColor: 'rgba(11,12,15,0.58)',
    marginBottom: 12,
  },
  url: { fontSize: font(10), color: '#CDBEAF' },
  text: { includeFontPadding: false },
  page: { flex: 1, backgroundColor: '#090A0C' },
  safeArea: { flex: 1 },
  primaryGlow: {
    position: 'absolute',
    width: 280,
    height: 280,
    borderRadius: 140,
    right: -150,
    top: -70,
    backgroundColor: 'rgba(245,184,108,0.2)',
    boxShadow: '0 0 86px rgba(245,184,108,0.2)',
  },
  secondaryGlow: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    left: -130,
    top: 310,
    backgroundColor: 'rgba(198,122,53,0.09)',
    boxShadow: '0 0 76px rgba(198,122,53,0.09)',
  },
  topBar: {
    height: 72,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 8,
    paddingRight: 18,
  },
  back: {
    width: 44,
    height: 44,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The artwork includes padding; fill the button so the arrow remains legible.
  backIcon: { width: 44, height: 44, resizeMode: 'contain' },
  topTitles: { flex: 1, marginLeft: 8, gap: 3 },
  pageTitle: { fontSize: font(20), fontWeight: '700', color: '#F4F7FB' },
  platform: {
    fontSize: font(8),
    color: 'rgba(245,184,108,0.72)',
    letterSpacing: 1,
  },
  version: {
    height: 25,
    paddingHorizontal: 9,
    borderRadius: 12.5,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.29)',
    backgroundColor: 'rgba(245,184,108,0.14)',
    justifyContent: 'center',
  },
  versionText: {
    fontSize: font(8),
    fontWeight: '700',
    color: orange,
    letterSpacing: 0.8,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 32,
    gap: 14,
  },
  card: {
    padding: 17,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.18)',
    backgroundImage:
      'linear-gradient(135deg, rgba(27,23,18,0.93), rgba(17,18,22,0.91))',
    boxShadow: '0 7px 16px rgba(0,0,0,0.52)',
  },
  overview: {
    borderColor: 'rgba(245,184,108,0.24)',
    backgroundImage:
      'linear-gradient(135deg, rgba(29,23,17,0.94), rgba(15,17,21,0.91))',
    boxShadow: '0 9px 20px rgba(0,0,0,0.52)',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: orange },
  eyebrow: {
    fontSize: font(9),
    fontWeight: '700',
    color: orange,
    letterSpacing: 1,
  },
  ready: {
    height: 23,
    paddingHorizontal: 9,
    borderRadius: 11.5,
    backgroundColor: 'rgba(245,184,108,0.13)',
    justifyContent: 'center',
  },
  readyText: {
    fontSize: font(8),
    fontWeight: '700',
    color: orange,
    letterSpacing: 0.8,
  },
  overviewTitle: {
    fontSize: font(18),
    fontWeight: '700',
    color: '#F4EEE6',
    marginTop: 13,
    marginBottom: 7,
  },
  overviewSubtitle: { fontSize: font(10), color: '#8E8377', lineHeight: 17 },
  pipeline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 15,
  },
  pipelineLabel: { fontSize: font(8), fontWeight: '700', color: '#9A8B7A' },
  separator: { fontSize: font(9), color: '#66513A' },
  accent: { color: orange },
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginBottom: 10,
  },
  step: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.27)',
    backgroundColor: 'rgba(245,184,108,0.13)',
    justifyContent: 'center',
  },
  stepText: { fontSize: font(9), fontWeight: '700', color: orange },
  sectionTitle: { fontSize: font(13.5), fontWeight: '700', color: '#F2ECE4' },
  picker: {
    height: 176,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.15)',
    backgroundColor: 'rgba(11,12,15,0.56)',
    overflow: 'hidden',
  },
  plusCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: 'rgba(245,184,108,0.24)',
    backgroundColor: 'rgba(245,184,108,0.09)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  plus: { fontSize: 26, color: orange },
  pickerTitle: {
    fontSize: font(12),
    fontWeight: '700',
    color: '#9D9185',
    marginTop: 11,
  },
  pickerType: {
    fontSize: font(9),
    color: '#62584E',
    letterSpacing: 0.8,
    marginTop: 5,
  },
  metadata: { flexDirection: 'row', gap: 8, marginTop: 10, marginBottom: 16 },
  metric: {
    flex: 1,
    height: 51,
    paddingLeft: 11,
    paddingRight: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(12,13,16,0.54)',
    justifyContent: 'center',
    gap: 4,
  },
  metricLabel: { fontSize: font(9), color: '#6E6257' },
  metricValue: { fontSize: font(10), fontWeight: '700', color: '#B9AA9B' },
});
