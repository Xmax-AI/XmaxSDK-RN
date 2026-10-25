import { useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Alert,
  Image,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { launchImageLibrary } from 'react-native-image-picker';
import { SafeAreaView } from 'react-native-safe-area-context';
import { RealtimeModel, XmaxSDKInfo } from '@xmaxai/react-native-sdk';
import { colors, feedFont as font } from '../theme/tokens';
import { FeedLanguageButton } from '../components/FeedLanguageButton';
import { useLocalization } from '../localization/LocalizationProvider';
import type { XLabLanguage } from '../localization/Localization';
import { StorageFeatureCard } from '../components/StorageFeatureCard';
import { FeedPipelineCard } from '../components/FeedPipelineCard';
import { FeedFeatureCard } from '../components/FeedFeatureCard';
import type {
  SavedConfiguration,
  XLabApiEndpoint,
} from '../configuration/ConfigurationStore';
import {
  endpointForLocale,
  modelForEndpoint,
  xlabModels,
} from '../configuration/ConfigurationStore';

function FeedText({ style, ...props }: ComponentProps<typeof Text>) {
  return <Text {...props} style={[styles.text, style]} />;
}

function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <FeedText style={styles.pillText}>{text}</FeedText>
    </View>
  );
}

/**
 * Displays SDK examples for the interface language's service environment.
 * Its parent owns secure persistence for each region's credentials.
 */
export function FeedScreen({
  onCamera,
  onImage,
  onExternalVideo,
  onStorage,
  configuration,
  onAPIKeyChange,
  onLanguageChange,
  onModelChange,
  onRetrySave,
}: {
  onCamera: (apiKey: string, endpoint: XLabApiEndpoint) => void;
  onImage: (
    apiKey: string,
    endpoint: XLabApiEndpoint,
    fileURL: string,
    customTrajectory: boolean,
    contentType: string | undefined,
  ) => void;
  onExternalVideo: (
    apiKey: string,
    endpoint: XLabApiEndpoint,
    fileURL: string,
  ) => void;
  onStorage: (apiKey: string, endpoint: XLabApiEndpoint) => void;
  configuration: SavedConfiguration;
  onAPIKeyChange: (value: string) => void;
  onLanguageChange: (language: XLabLanguage) => void;
  onModelChange: (model: RealtimeModel) => void;
  onRetrySave: () => void;
}) {
  const { t, locale } = useLocalization();
  const endpoint = endpointForLocale(locale);
  const models = xlabModels[endpoint];
  const selectedModel = modelForEndpoint(configuration.model, endpoint);
  const apiKey = configuration.keys[endpoint];
  const [visible, setVisible] = useState(false);

  const pickerOpen = useRef(false),
    mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  /** Opens the portal for the locale-selected API environment. */
  async function openAPIKeyPage() {
    const url =
      endpoint === 'global'
        ? 'https://platform.xmax.ai/api-keys'
        : 'https://platform.xmaxai.com/api-keys';

    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert(t('feed.api.openError'), t('feed.api.openHelp', { url }), [
        { text: t('common.ok') },
      ]);
    }
  }

  /** Guards every feature entry using the current environment's key. */
  function requireAPIKey(): boolean {
    if (apiKey.trim()) return true;

    Alert.alert(t('common.notice'), t('feed.api.required'), [
      { text: t('common.ok') },
    ]);

    return false;
  }

  /** Selects a video for the app-owned native decoder. */
  async function openExternalVideo() {
    if (pickerOpen.current || !requireAPIKey()) return;
    pickerOpen.current = true;
    try {
      const result = await launchImageLibrary({
        mediaType: 'video',
        selectionLimit: 1,
        assetRepresentationMode: 'current',
      });
      if (!mounted.current || result.didCancel) return;
      const uri = result.assets?.[0]?.uri;
      if (result.errorCode || !uri)
        throw new Error('Unable to read selected video');
      onExternalVideo(apiKey.trim(), endpoint, uri);
    } catch {
      if (mounted.current)
        Alert.alert(t('feed.external.pickError'), t('feed.external.error'));
    } finally {
      pickerOpen.current = false;
    }
  }

  /** Selects an input image; the destination owns preparation and RTC resources. */
  async function openImage(customTrajectory = false) {
    if (pickerOpen.current || !requireAPIKey()) return;

    pickerOpen.current = true;
    try {
      const result = await launchImageLibrary({
        mediaType: 'photo',
        selectionLimit: 1,
        includeBase64: false,
        assetRepresentationMode: 'current',
      });

      if (!mounted.current || result.didCancel) return;
      if (result.errorCode)
        throw new Error(result.errorMessage || t('feed.image.error'));

      const fileURL = result.assets?.[0]?.uri;

      if (!fileURL) throw new Error(t('feed.file.error'));
      onImage(
        apiKey.trim(),
        endpoint,
        fileURL,
        customTrajectory,
        result.assets?.[0]?.type,
      );
    } catch {
      if (mounted.current)
        Alert.alert(t('feed.image.pickError'), t('feed.image.error'), [
          { text: t('common.ok') },
        ]);
    } finally {
      pickerOpen.current = false;
    }
  }

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.blueGlow} />
      <View pointerEvents="none" style={styles.mintGlow} />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <ScrollView
          contentInsetAdjustmentBehavior="never"
          automaticallyAdjustContentInsets={false}
          automaticallyAdjustsScrollIndicatorInsets={false}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.header}>
            <View style={styles.brandRow}>
              <View style={styles.brandMark} accessible={false}>
                <View style={styles.brandDiamond} />
                <FeedText style={styles.brandLetter}>X</FeedText>
              </View>
              <View style={styles.brandText}>
                <FeedText style={styles.brand}>XMAXSDK</FeedText>
                <FeedText style={styles.caption}>
                  EXAMPLE / REACT NATIVE
                </FeedText>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pill text={`v${XmaxSDKInfo.version}`} />
              <FeedLanguageButton
                language={configuration.language}
                onChange={onLanguageChange}
              />
            </View>
          </View>

          <View style={styles.hero}>
            <View pointerEvents="none" style={styles.heroGlow} />
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowLine} />
              <FeedText style={styles.eyebrow}>XMAX PLAYGROUND</FeedText>
            </View>
            <FeedText style={styles.title}>{t('feed.hero.title')}</FeedText>
            <FeedText style={styles.heroSubtitle}>
              {t('feed.hero.subtitle')}
            </FeedText>
          </View>

          <View style={styles.metrics}>
            {[
              [
                t('feed.runtime'),
                Platform.OS === 'ios' ? 'RN / iOS' : 'RN / Android',
              ],
              [t('feed.os'), Platform.OS === 'ios' ? '15.1+' : '8.0+'],
              [t('feed.latestModel'), 'X2.1.1 PREVIEW'],
            ].map(([label, value]) => (
              <View key={label} style={styles.metric}>
                <FeedText
                  style={styles.metricLabel}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                >
                  {label}
                </FeedText>
                <FeedText
                  style={styles.metricValue}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                >
                  {value}
                </FeedText>
              </View>
            ))}
          </View>

          <View style={styles.registry}>
            <View style={styles.row}>
              <FeedText style={styles.registryTitle}>
                {t('feed.model.title')}
              </FeedText>
              <FeedText style={styles.modelCount}>
                {t('feed.model.count', {
                  count: models.length,
                })}
              </FeedText>
            </View>
            <View style={styles.apiContainer}>
              <FeedText style={styles.apiLabel}>API KEY</FeedText>
              <View style={styles.passwordField}>
                <TextInput
                  key={endpoint}
                  accessibilityLabel="API Key"
                  style={styles.input}
                  placeholder={t('feed.api.placeholder')}
                  placeholderTextColor="rgba(96,112,128,0.5)"
                  value={apiKey}
                  onChangeText={onAPIKeyChange}
                  secureTextEntry={!visible}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  returnKeyType="done"
                  selectionColor={colors.accent}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t(
                    visible ? 'feed.api.hide' : 'feed.api.show',
                  )}
                  onPress={() => setVisible(!visible)}
                  style={styles.visibilityButton}
                  hitSlop={10}
                >
                  <Image
                    style={styles.visibilityIcon}
                    source={
                      visible
                        ? require('../assets/feed/api_key_hidden.png')
                        : require('../assets/feed/api_key_visible.png')
                    }
                  />
                </Pressable>
              </View>
              <View style={styles.helpRow}>
                <FeedText style={styles.helpText}>
                  {t('feed.api.prompt')}
                </FeedText>
                <Pressable
                  accessibilityRole="link"
                  onPress={openAPIKeyPage}
                  hitSlop={6}
                >
                  <FeedText style={styles.helpLink}>
                    {t('feed.api.link')}
                  </FeedText>
                </Pressable>
              </View>
              {configuration.error && (
                <View style={styles.helpRow}>
                  <FeedText
                    style={styles.helpText}
                    accessibilityLiveRegion="polite"
                  >
                    {t(configuration.error)}
                  </FeedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={onRetrySave}
                    hitSlop={8}
                  >
                    <FeedText style={styles.helpLink}>
                      {t('common.retry')}
                    </FeedText>
                  </Pressable>
                </View>
              )}
            </View>
            <View style={styles.divider} />
            {Object.entries(RealtimeModel)
              .filter(([, model]) => models.includes(model))
              .map(([identifier, model]) => (
                <Pressable
                  key={model}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selectedModel === model,
                  }}
                  accessibilityLabel={model.toUpperCase()}
                  onPress={() => onModelChange(model)}
                  style={[
                    styles.model,
                    selectedModel === model && styles.selectedModel,
                  ]}
                >
                  <FeedText style={styles.modelDiamond}>◆</FeedText>
                  <View style={styles.modelText}>
                    <FeedText style={styles.modelTitle}>
                      {model.toUpperCase()}
                    </FeedText>
                    <FeedText style={styles.modelIdentifier}>
                      {`RealtimeModel.${identifier}`}
                    </FeedText>
                  </View>
                  {selectedModel === model && (
                    <Pill text={t('feed.selected')} />
                  )}
                </Pressable>
              ))}
          </View>

          <View style={styles.section}>
            <FeedText style={styles.sectionTitle}>
              {t('feed.pipelines')}
            </FeedText>
            <FeedText style={styles.sectionSubtitle}>
              {t('feed.input')}
            </FeedText>
          </View>
          <View style={styles.cards}>
            <FeedPipelineCard
              sequence="01"
              mode="MODE_01 / CAMERA"
              accentColor={colors.accent}
              title={t('feed.camera.title')}
              subtitle={t('feed.camera.subtitle')}
              capability="createLocalCameraStream()"
              onPress={() => {
                if (requireAPIKey()) onCamera(apiKey.trim(), endpoint);
              }}
            />
            <FeedPipelineCard
              sequence="02"
              mode="MODE_02 / IMAGE.FILE"
              accentColor={colors.image}
              title={t('feed.image.title')}
              subtitle={t('feed.image.subtitle')}
              capability="createLocalImageStream()"
              onPress={() => {
                void openImage();
              }}
            />
          </View>
          <View style={styles.section}>
            <FeedText style={styles.sectionTitle}>
              {t('feed.features')}
            </FeedText>
            <FeedText style={styles.sectionSubtitle}>
              {t('feed.examples')}
            </FeedText>
          </View>
          <View style={styles.cards}>
            <FeedFeatureCard
              category="SDK MEDIA / EXTERNAL"
              watermark="PCM"
              accentColor={colors.accent}
              icon={require('../assets/feed/external.png')}
              iconLabel="EXTERNAL"
              title={t('feed.external.title')}
              subtitle={t('feed.external.subtitle')}
              tags={['EXTERNAL SOURCE', 'VIDEO', 'PCM AUDIO']}
              highlightedTag="EXTERNAL SOURCE"
              onPress={() => {
                void openExternalVideo();
              }}
            />
            <FeedFeatureCard
              category="SDK RENDERING / TRAJECTORY"
              watermark="FX"
              accentColor={colors.trajectory}
              icon={require('../assets/feed/trajectory.png')}
              iconLabel="RENDER"
              title={t('feed.render.title')}
              subtitle={t('feed.render.subtitle')}
              tags={['CANVAS', 'MULTI-TOUCH', 'CUSTOM EFFECT']}
              highlightedTag="CUSTOM EFFECT"
              onPress={() => {
                void openImage(true);
              }}
            />
            <StorageFeatureCard
              onPress={() => {
                if (requireAPIKey()) onStorage(apiKey.trim(), endpoint);
              }}
            />
          </View>
          <View style={styles.footer}>
            <View style={styles.footerDivider} />
            <FeedText style={styles.copyright}>
              Copyright © 2026 XMAX.AI PTE. LTD. All rights reserved.
            </FeedText>
            <FeedText style={styles.email}>sdk@xmax.ai</FeedText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  text: { includeFontPadding: false },
  page: {
    flex: 1,
    backgroundColor: colors.background,
    backgroundImage: 'linear-gradient(145deg, #0C121B, #070A0F, #090D13)',
  },
  safeArea: { flex: 1 },
  blueGlow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    right: -135,
    top: -55,
    backgroundColor: 'rgba(75,123,255,0.14)',
    boxShadow: '0 0 70px rgba(75,123,255,0.14)',
  },
  mintGlow: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    left: -145,
    top: 330,
    backgroundColor: 'rgba(77,240,181,0.12)',
    boxShadow: '0 0 75px rgba(77,240,181,0.12)',
  },
  content: { paddingHorizontal: 18, paddingTop: 20, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 34,
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', flexShrink: 0 },
  brandRow: {
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  brandMark: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandDiamond: {
    position: 'absolute',
    width: 25,
    height: 25,
    borderRadius: 8,
    transform: [{ rotate: '45deg' }],
    backgroundImage: 'linear-gradient(135deg, #8EF0C8, #6495FF)',
  },
  brandLetter: { fontSize: font(12), fontWeight: '700', color: '#07110D' },
  brandText: { gap: 3, flexShrink: 1 },
  brand: {
    fontSize: font(15),
    fontWeight: '700',
    letterSpacing: 1.8,
    color: '#F2F4F7',
  },
  caption: {
    fontSize: font(8),
    letterSpacing: 1,
    color: 'rgba(255,255,255,0.38)',
  },
  pill: {
    height: 26,
    paddingHorizontal: 11,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(142,240,200,0.086)',
    justifyContent: 'center',
  },
  pillText: {
    fontSize: font(9),
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.accent,
  },
  hero: {
    padding: 20,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundImage:
      'linear-gradient(135deg, rgba(20,29,40,0.88), rgba(12,17,24,0.82))',
    boxShadow: '0 10px 24px rgba(0,0,0,0.52)',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    right: -36,
    bottom: -42,
    backgroundColor: 'rgba(104,149,255,0.08)',
    boxShadow: '0 0 28px rgba(104,149,255,0.08)',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginBottom: 18,
  },
  eyebrowLine: {
    width: 22,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.accent,
  },
  eyebrow: {
    fontSize: font(9),
    fontWeight: '700',
    color: colors.accent,
    letterSpacing: 1.2,
  },
  title: {
    fontSize: font(22),
    fontWeight: '700',
    letterSpacing: -0.3,
    color: '#F5F7FB',
    marginBottom: 12,
  },
  heroSubtitle: { fontSize: font(11), color: '#91A0B2' },
  metrics: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 14 },
  metric: {
    flex: 1,
    height: 66,
    justifyContent: 'center',
    paddingLeft: 12,
    paddingRight: 10,
    gap: 7,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(14,20,28,0.7)',
  },
  metricLabel: {
    fontSize: font(8),
    fontWeight: '700',
    color: 'rgba(255,255,255,0.38)',
    letterSpacing: 1,
  },
  metricValue: { fontSize: font(12), fontWeight: '700', color: '#E8EDF5' },
  registry: {
    padding: 18,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: 'rgba(142,240,200,0.15)',
    backgroundImage:
      'linear-gradient(135deg, rgba(18,27,25,0.91), rgba(13,18,24,0.91))',
    boxShadow: '0 8px 18px rgba(0,0,0,0.52)',
  },
  registryTitle: { fontSize: font(13), fontWeight: '700', color: '#E9EDF3' },
  modelCount: {
    fontSize: font(8),
    color: 'rgba(255,255,255,0.44)',
    letterSpacing: 0.8,
  },
  apiContainer: {
    marginTop: 14,
    padding: 10,
    paddingBottom: 11,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: 'rgba(8,12,18,0.26)',
  },
  apiLabel: {
    fontSize: font(8),
    fontWeight: '700',
    letterSpacing: 0.9,
    color: '#7E8A9A',
  },
  passwordField: {
    height: 40,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    backgroundColor: 'rgba(8,12,18,0.4)',
  },
  input: {
    flex: 1,
    minWidth: 0,
    height: '100%',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 0,
    fontSize: font(10),
    includeFontPadding: false,
    color: '#D6DEE9',
  },
  visibilityButton: { width: 20, height: 20, marginRight: 8 },
  visibilityIcon: { width: 20, height: 20, opacity: 0.78 },
  helpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 7,
  },
  helpText: { fontSize: font(9), color: 'rgba(112,128,144,0.6)' },
  helpLink: { fontSize: font(9), color: 'rgba(142,240,200,0.63)' },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.09)',
    marginTop: 12,
    marginBottom: 4,
  },
  model: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 10,
    paddingRight: 8,
    borderRadius: 10,
    marginTop: 4,
    backgroundColor: 'rgba(255,255,255,0.025)',
  },
  selectedModel: {
    borderWidth: 1,
    borderColor: 'rgba(142,240,200,0.16)',
    backgroundColor: 'rgba(142,240,200,0.063)',
  },
  modelDiamond: { fontSize: font(7), color: colors.accent },
  modelText: { flex: 1, gap: 3 },
  modelTitle: { fontSize: font(13), fontWeight: '700', color: '#F0F2F5' },
  modelIdentifier: { fontSize: font(8), color: 'rgba(255,255,255,0.44)' },
  section: { gap: 5, marginTop: 30, marginBottom: 14 },
  sectionTitle: {
    fontSize: font(13),
    fontWeight: '700',
    letterSpacing: 1.1,
    color: '#C6D0DD',
  },
  sectionSubtitle: { fontSize: font(11), color: '#667384' },
  cards: { gap: 14 },
  footer: { alignItems: 'center', marginTop: 10, paddingBottom: 32 },
  footerDivider: {
    width: 36,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.09)',
    marginBottom: 18,
  },
  copyright: {
    fontSize: font(9),
    color: 'rgba(255,255,255,0.31)',
    textAlign: 'center',
  },
  email: {
    fontSize: font(9),
    color: 'rgba(142,240,200,0.41)',
    letterSpacing: 0.4,
    marginTop: 7,
  },
});
