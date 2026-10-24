import { Pressable, StyleSheet, Text, View } from 'react-native';
import type {
  RealtimeQualityLevel,
  UplinkVideoStatistics,
  DownlinkVideoStatistics,
} from '@xmaxai/react-native-sdk';
import { useLocalization } from '../localization/LocalizationProvider';

/** Displays measured video transport metrics; unavailable values stay explicit instead of showing configured targets. */
export function RealtimeStatisticsPanel({
  uplink,
  downlink,
  uplinkLevel,
  downlinkLevel,
  canChange,
  onUplinkChange,
  onDownlinkChange,
}: {
  uplink: UplinkVideoStatistics | null;
  downlink: DownlinkVideoStatistics | null;
  uplinkLevel: RealtimeQualityLevel | null;
  downlinkLevel: RealtimeQualityLevel | null;
  canChange: boolean;
  onUplinkChange: (level: RealtimeQualityLevel) => void;
  onDownlinkChange: (level: RealtimeQualityLevel) => void;
}) {
  const { t } = useLocalization();
  const value = (n: number | null | undefined, unit = '') =>
    n == null ? '—' : `${n}${unit}`;
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>{t('realtime.statistics.uplink')}</Text>
      <QualityPicker
        level={uplinkLevel}
        enabled={canChange}
        onChange={onUplinkChange}
        label={t('realtime.statistics.uplinkQuality')}
      />
      <Text style={styles.row}>
        {value(uplink?.width)} × {value(uplink?.height)} ·{' '}
        {value(uplink?.bitrateKbps, ' kbps')}
      </Text>
      <Text style={styles.row}>
        {t('realtime.statistics.capture')} {value(uplink?.captureFrameRate)} ·{' '}
        {t('realtime.statistics.encode')} {value(uplink?.encodeFrameRate)} ·{' '}
        {t('realtime.statistics.send')} {value(uplink?.sendFrameRate)} fps
      </Text>
      <Text style={styles.row}>
        {t('realtime.statistics.loss')} {value(uplink?.packetLossPercent, '%')}
      </Text>
      <Text style={styles.title}>{t('realtime.statistics.downlink')}</Text>
      <QualityPicker
        level={downlinkLevel}
        enabled={canChange}
        onChange={onDownlinkChange}
        label={t('realtime.statistics.downlinkQuality')}
      />
      <Text style={styles.row}>
        {value(downlink?.width)} × {value(downlink?.height)} ·{' '}
        {value(downlink?.bitrateKbps, ' kbps')}
      </Text>
      <Text style={styles.row}>
        {t('realtime.statistics.decode')} {value(downlink?.decodeFrameRate)} ·{' '}
        {t('realtime.statistics.render')} {value(downlink?.renderFrameRate)} fps
      </Text>
      <Text style={styles.row}>
        {t('realtime.statistics.loss')}{' '}
        {value(downlink?.packetLossPercent, '%')} ·{' '}
        {t('realtime.statistics.delay')}{' '}
        {value(downlink?.endToEndDelayMs, ' ms')}
      </Text>
    </View>
  );
}

/** Displays acknowledged tiers and offers manual changes only during generation. */
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
    <View style={styles.levels}>
      <Text style={styles.row}>
        {label} {level == null ? '—' : `L${level}`}
      </Text>
      {([1, 2, 3, 4, 5] as RealtimeQualityLevel[]).map(option => (
        <Pressable
          key={option}
          accessibilityRole="button"
          accessibilityLabel={`${label} L${option}`}
          accessibilityState={{
            selected: level === option,
            disabled: !enabled,
          }}
          disabled={!enabled}
          onPress={() => onChange(option)}
          style={[
            styles.level,
            level === option && styles.selected,
            !enabled && styles.disabled,
          ]}
        >
          <Text style={styles.row}>L{option}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  levels: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginVertical: 4,
  },
  level: {
    paddingHorizontal: 7,
    paddingVertical: 7,
    borderRadius: 6,
    backgroundColor: '#FFFFFF22',
  },
  selected: { backgroundColor: '#258E75' },
  disabled: { opacity: 0.5 },
  panel: { padding: 12, borderRadius: 12, backgroundColor: '#000B', gap: 3 },
  title: { fontSize: 12, fontWeight: '700', color: '#8EF0C8', marginTop: 4 },
  row: { fontSize: 11, color: '#FFF' },
});
