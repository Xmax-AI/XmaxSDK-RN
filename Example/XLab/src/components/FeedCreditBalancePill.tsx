import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import {
  formatFeedCreditBalance,
  type FeedCreditBalanceState,
} from '../feed/FeedCreditBalance';
import { useLocalization } from '../localization/LocalizationProvider';
import { colors, feedFont as font } from '../theme/tokens';

/** Displays remaining credits without hiding a previous balance during refresh. */
export function FeedCreditBalancePill({
  state,
}: {
  state: FeedCreditBalanceState;
}) {
  const { t } = useLocalization();
  const initialLoading = state.isLoading && state.balance === null;
  const value =
    state.balance === null && state.refreshFailed
      ? t('feed.credits.unavailable')
      : formatFeedCreditBalance(state.balance);

  return (
    <View
      testID="feed.creditBalance"
      style={styles.pill}
      accessible
      accessibilityLabel={t('feed.credits')}
      accessibilityValue={{
        text: initialLoading ? t('feed.credits.loading') : value,
      }}
      accessibilityState={{ busy: initialLoading }}
      accessibilityHint={
        state.refreshFailed ? t('feed.credits.refreshFailed') : undefined
      }
    >
      <Text style={styles.label} numberOfLines={1}>
        {t('feed.credits')}
      </Text>
      {initialLoading ? (
        <View style={styles.spinner}>
          <ActivityIndicator
            size="small"
            color={colors.accent}
            style={styles.spinnerScale}
          />
        </View>
      ) : (
        <Text
          style={[styles.value, state.refreshFailed && styles.failed]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(142,240,200,0.14)',
    backgroundColor: 'rgba(142,240,200,0.07)',
    maxWidth: '80%',
    flexShrink: 1,
  },
  label: {
    fontSize: font(10),
    color: colors.secondary,
    includeFontPadding: false,
  },
  value: {
    fontSize: font(11),
    fontWeight: '500',
    color: colors.accent,
    includeFontPadding: false,
    flexShrink: 1,
  },
  failed: { color: colors.storage },
  spinner: {
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinnerScale: { transform: [{ scale: 0.6 }] },
});
