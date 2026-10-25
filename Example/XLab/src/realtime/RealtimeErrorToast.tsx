import type { MessageKey } from '../localization/messages';
import { useLocalization } from '../localization/LocalizationProvider';
import { useEffect } from 'react';
import {
  AccessibilityInfo,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

/** A new object represents each error occurrence, including repeated messages. */
export interface RealtimeErrorNotice {
  readonly message: string;
  readonly kind?: 'success';
  /** Translate at render time so an existing notice follows language changes. */
  readonly messageKey?: MessageKey;
  readonly permissionError: boolean;
}

/**
 * Displays errors above the preview without taking space from its layout.
 * Ordinary errors dismiss after six seconds; recovery actions stay available
 * until handled or dismissed. Timers are cleared on replacement and unmount.
 */
export function RealtimeErrorToast({
  notice,
  top,
  actionLabel,
  onAction,
  onDismiss,
}: {
  notice: RealtimeErrorNotice | null;
  top: number;
  actionLabel: string | null;
  onAction: () => void;
  onDismiss: () => void;
}) {
  const { t } = useLocalization();
  const message = notice?.messageKey ? t(notice.messageKey) : notice?.message;

  useEffect(() => {
    if (!notice) return;
    if (Platform.OS === 'ios')
      AccessibilityInfo.announceForAccessibility(message ?? notice.message);
    if (actionLabel) return;

    const timer = setTimeout(onDismiss, 6000);

    return () => clearTimeout(timer);
  }, [notice, message, actionLabel, onDismiss]);

  if (!notice) return null;

  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top }]}>
      <View style={[styles.toast, notice.kind === 'success' && styles.success]}>
        <View style={styles.messageRow}>
          <ScrollView style={styles.message} bounces={false}>
            <Text
              style={[
                styles.text,
                notice.kind === 'success' && styles.successText,
              ]}
              accessibilityLiveRegion="polite"
            >
              {message}
            </Text>
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t(
              notice.kind === 'success'
                ? 'common.dismissNotice'
                : 'common.dismissError',
            )}
            onPress={onDismiss}
            style={styles.dismiss}
          >
            <Text
              style={[
                styles.dismissText,
                notice.kind === 'success' && styles.successText,
              ]}
            >
              ×
            </Text>
          </Pressable>
        </View>
        {actionLabel && (
          <Pressable
            accessibilityRole="button"
            onPress={onAction}
            style={styles.action}
          >
            <Text style={styles.actionText}>{actionLabel}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', left: 14, right: 14, zIndex: 20 },
  toast: {
    backgroundColor: '#381B1BF5',
    borderRadius: 14,
    paddingLeft: 14,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  success: { backgroundColor: '#153B2DF5' },
  successText: { color: '#D8FFED' },
  messageRow: { flexDirection: 'row', alignItems: 'center' },
  message: { flex: 1, maxHeight: 152, marginVertical: 8 },
  text: {
    fontSize: 13,
    lineHeight: 19,
    color: '#FFD6D6',
    includeFontPadding: false,
  },
  dismiss: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dismissText: {
    fontSize: 24,
    lineHeight: 24,
    color: '#FFD6D6',
    includeFontPadding: false,
  },
  action: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  actionText: { fontSize: 13, color: '#8EF0C8', fontWeight: '600' },
});
