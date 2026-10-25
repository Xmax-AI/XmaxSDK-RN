import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useLocalization } from '../localization/LocalizationProvider';

/** Adjusts remote playback volume from zero to one without changing audio subscription. */
export function RealtimeAudioVolumeMenu({
  value,
  top,
  right,
  onChange,
  onDismiss,
}: {
  value: number;
  top: number;
  right: number;
  onChange: (volume: number) => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const [trackWidth, setTrackWidth] = useState(0);
  const volume = Math.max(0, Math.min(1, value));
  const updatePosition = (x: number) => {
    if (trackWidth > 0) onChange(Math.max(0, Math.min(1, x / trackWidth)));
  };
  return (
    <View
      style={[StyleSheet.absoluteFill, styles.overlay]}
      pointerEvents="box-none"
    >
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityLabel={t('realtime.volume.dismiss')}
        onPress={onDismiss}
      />
      <View style={[styles.menu, { top, right }]} accessibilityViewIsModal>
        <View style={styles.row}>
          <Text style={styles.title}>{t('realtime.volume.remote')}</Text>
          <Text style={styles.value}>{Math.round(volume * 100)}%</Text>
        </View>
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel={t('realtime.volume.remote.adjust')}
          accessibilityValue={{
            min: 0,
            max: 100,
            now: Math.round(volume * 100),
          }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={event => {
            if (event.nativeEvent.actionName === 'increment')
              onChange(Math.min(1, volume + 0.1));
            else if (event.nativeEvent.actionName === 'decrement')
              onChange(Math.max(0, volume - 0.1));
          }}
          style={styles.slider}
          onLayout={event => setTrackWidth(event.nativeEvent.layout.width)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={event =>
            updatePosition(event.nativeEvent.locationX)
          }
          onResponderMove={event => updatePosition(event.nativeEvent.locationX)}
        >
          <View pointerEvents="none" style={styles.track} />
          <View
            pointerEvents="none"
            style={[styles.fill, { width: `${volume * 100}%` }]}
          />
          <View
            pointerEvents="none"
            style={[styles.thumb, { left: `${volume * 100}%` }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { zIndex: 30 },
  menu: {
    position: 'absolute',
    width: 260,
    height: 82,
    padding: 14,
    borderRadius: 14,
    backgroundColor: '#1C1C1E',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { fontSize: 13, fontWeight: '500', color: '#FFF' },
  value: { fontSize: 12, fontVariant: ['tabular-nums'], color: '#AAA' },
  slider: { height: 34, marginTop: 4, justifyContent: 'center' },
  track: {
    position: 'absolute',
    height: 4,
    width: '100%',
    backgroundColor: '#555',
    borderRadius: 2,
  },
  fill: {
    position: 'absolute',
    height: 4,
    backgroundColor: '#FF2D55',
    borderRadius: 2,
  },
  thumb: {
    position: 'absolute',
    width: 24,
    height: 24,
    marginLeft: -12,
    borderRadius: 12,
    backgroundColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
