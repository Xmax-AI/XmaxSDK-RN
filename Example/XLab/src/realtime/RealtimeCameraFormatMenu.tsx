import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { RealtimeVideoFormat } from '@xmaxai/react-native-sdk';
import { useLocalization } from '../localization/LocalizationProvider';

/** Returns the capture format's reduced width-to-height ratio. */
export function cameraAspectRatioLabel(format: RealtimeVideoFormat): string {
  let divisor = format.width;
  let remainder = format.height;
  while (remainder) [divisor, remainder] = [remainder, divisor % remainder];
  return `${format.width / divisor}:${format.height / divisor}`;
}

/** Selects a supported camera format and marks the currently acknowledged dimensions. */
export function RealtimeCameraFormatMenu({
  formats,
  selectedFormat,
  bottomInset,
  onSelect,
  onDismiss,
}: {
  formats: readonly RealtimeVideoFormat[];
  selectedFormat: RealtimeVideoFormat | null;
  bottomInset: number;
  onSelect: (format: RealtimeVideoFormat) => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  return (
    <Modal
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <Pressable
          style={StyleSheet.absoluteFill}
          accessibilityRole="button"
          accessibilityLabel={t('realtime.camera.format.dismiss')}
          onPress={onDismiss}
        />
        <View
          style={[styles.sheet, { marginBottom: Math.max(bottomInset, 8) }]}
          accessibilityViewIsModal
        >
          <View style={styles.options}>
            <Text accessibilityRole="header" style={styles.title}>
              {t('realtime.camera.format')}
            </Text>
            <ScrollView bounces={false}>
              {formats.map(format => {
                const selected =
                  selectedFormat?.width === format.width &&
                  selectedFormat?.height === format.height;
                return (
                  <Pressable
                    key={`${format.width}x${format.height}`}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: selected }}
                    accessibilityLabel={cameraAspectRatioLabel(format)}
                    onPress={() => onSelect(format)}
                    style={({ pressed }) => [
                      styles.option,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.label}>
                      {cameraAspectRatioLabel(format)}
                    </Text>
                    <Text style={styles.check} accessible={false}>
                      {selected ? '✓' : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={onDismiss}
            style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
          >
            <Text style={[styles.label, styles.cancelLabel]}>
              {t('common.cancel')}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  sheet: {
    marginHorizontal: 12,
    width: '94%',
    maxWidth: 420,
    maxHeight: '85%',
    alignSelf: 'center',
  },
  options: {
    flexShrink: 1,
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
    overflow: 'hidden',
  },
  title: { padding: 16, textAlign: 'center', fontSize: 13, color: '#AAA' },
  option: {
    minHeight: 52,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#444',
  },
  label: { color: '#0A84FF', fontSize: 18, textAlign: 'center' },
  check: { position: 'absolute', right: 24, color: '#0A84FF', fontSize: 18 },
  cancel: {
    minHeight: 52,
    marginTop: 8,
    justifyContent: 'center',
    backgroundColor: '#1C1C1E',
    borderRadius: 14,
  },
  cancelLabel: { fontWeight: '600' },
  pressed: { backgroundColor: '#343438' },
});
