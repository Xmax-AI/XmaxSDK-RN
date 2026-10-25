import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type {
  RealtimeQualityLevel,
  RealtimeNetworkQuality,
  RealtimeNetworkQualityLevel,
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '@xmaxai/react-native-sdk';
import { useLocalization } from '../localization/LocalizationProvider';
import type { MessageKey } from '../localization/messages';
import type { RemoteMediaFrameStatistics } from './RemoteMediaFrameReception';

/** Displays acknowledged transport tiers and measured statistics in a height-constrained scroll view. */
export function RealtimeStatisticsPanel({
  uplink,
  downlink,
  receivesMediaFrames,
  mediaFrames,
  networkQuality,
  uplinkLevel,
  downlinkLevel,
  canChange,
  adjusting,
  onUplinkChange,
  onDownlinkChange,
}: {
  uplink: UplinkVideoStatistics | null;
  downlink: DownlinkVideoStatistics | null;
  receivesMediaFrames: boolean;
  mediaFrames: RemoteMediaFrameStatistics | null;
  networkQuality: RealtimeNetworkQuality | null;
  uplinkLevel: RealtimeQualityLevel | null;
  downlinkLevel: RealtimeQualityLevel | null;
  canChange: boolean;
  adjusting: boolean;
  onUplinkChange: (level: RealtimeQualityLevel) => void;
  onDownlinkChange: (level: RealtimeQualityLevel) => void;
}) {
  const { t } = useLocalization();
  const value = (n: number | null | undefined, unit = '') =>
    n == null ? '—' : `${n} ${unit}`.trim();
  const resolution = (width?: number | null, height?: number | null) =>
    width == null || height == null ? '—' : `${width} × ${height}`;
  const quality = (level?: RealtimeNetworkQualityLevel) =>
    !level || level === 'Unknown'
      ? '—'
      : t(`realtime.statistics.quality.${level}`);
  const row = (key: MessageKey, text: string) => (
    <View style={styles.row} key={key}>
      <Text style={styles.label}>{t(key)}</Text>
      <Text
        style={styles.value}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
      >
        {text}
      </Text>
    </View>
  );
  return (
    <ScrollView
      style={styles.panel}
      contentContainerStyle={styles.content}
      bounces={false}
    >
      <Text style={styles.heading}>{t('realtime.statistics.uplink')}</Text>
      <QualityPicker
        level={uplinkLevel}
        enabled={canChange && !adjusting}
        onChange={onUplinkChange}
        label={t('realtime.statistics.uplink')}
      />
      {row(
        'realtime.statistics.resolution',
        resolution(uplink?.width, uplink?.height),
      )}
      {row(
        'realtime.statistics.capture',
        value(uplink?.captureFrameRate, 'fps'),
      )}
      {row('realtime.statistics.encode', value(uplink?.encodeFrameRate, 'fps'))}
      {row('realtime.statistics.send', value(uplink?.sendFrameRate, 'fps'))}
      {row('realtime.statistics.bitrate', value(uplink?.bitrateKbps, 'kbps'))}
      {row('realtime.statistics.loss', value(uplink?.packetLossPercent, '%'))}
      {row('realtime.statistics.network', quality(networkQuality?.uplink))}
      <Text style={[styles.heading, styles.downlink]}>
        {t('realtime.statistics.downlink')}
      </Text>
      <QualityPicker
        level={downlinkLevel}
        enabled={canChange && !adjusting}
        onChange={onDownlinkChange}
        label={t('realtime.statistics.downlink')}
      />
      {row(
        'realtime.statistics.resolution',
        resolution(downlink?.width, downlink?.height),
      )}
      {row(
        'realtime.statistics.decode',
        value(downlink?.decodeFrameRate, 'fps'),
      )}
      {row(
        'realtime.statistics.render',
        value(downlink?.renderFrameRate, 'fps'),
      )}
      {row('realtime.statistics.bitrate', value(downlink?.bitrateKbps, 'kbps'))}
      {row('realtime.statistics.loss', value(downlink?.packetLossPercent, '%'))}
      {row('realtime.statistics.network', quality(networkQuality?.downlink))}
      {row('realtime.statistics.delay', value(downlink?.endToEndDelayMs, 'ms'))}
      <Text style={styles.hint}>{t('realtime.statistics.hint')}</Text>
      {receivesMediaFrames && (
        <>
          <Text style={[styles.heading, styles.downlink]}>
            {t('realtime.statistics.mediaFrames')}
          </Text>
          {row(
            'realtime.statistics.videoFrames',
            value(mediaFrames?.videoFrames),
          )}
          {row(
            'realtime.statistics.audioPackets',
            value(mediaFrames?.audioPackets),
          )}
        </>
      )}
    </ScrollView>
  );
}

/** Keeps acknowledged tiers selected and disables the active tier or unavailable adjustments. */
function QualityPicker({
  level,
  enabled,
  onChange,
  label,
}: {
  level: RealtimeQualityLevel | null;
  enabled: boolean;
  onChange: (level: RealtimeQualityLevel) => void;
  label: string;
}) {
  return (
    <View style={[styles.levels, !enabled && styles.disabled]}>
      {([1, 2, 3, 4, 5] as RealtimeQualityLevel[]).map(option => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityLabel={`${label} L${option}`}
          accessibilityState={{
            selected: level === option,
            disabled: !enabled || level === option,
          }}
          disabled={!enabled || level === option}
          onPress={() => onChange(option)}
          style={[styles.level, level === option && styles.selected]}
        >
          <Text style={styles.levelText}>L{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { flexShrink: 1, borderRadius: 8, backgroundColor: '#000000A3' },
  content: { padding: 10, gap: 3 },
  heading: { minHeight: 15, fontSize: 11, fontWeight: '600', color: '#FFF' },
  downlink: { marginTop: 6 },
  row: { minHeight: 14, flexDirection: 'row', alignItems: 'center', gap: 4 },
  label: { color: '#FFFFFFB3', fontSize: 10 },
  value: {
    flex: 1,
    textAlign: 'right',
    color: '#FFF',
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
  levels: { flexDirection: 'row', gap: 3 },
  level: {
    flex: 1,
    minHeight: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    backgroundColor: '#FFFFFF26',
  },
  selected: { backgroundColor: '#007AFF' },
  levelText: { fontSize: 10, fontWeight: '600', color: '#FFF' },
  disabled: { opacity: 0.5 },
  hint: { marginTop: 4, fontSize: 9, color: '#FFFFFF99' },
});
