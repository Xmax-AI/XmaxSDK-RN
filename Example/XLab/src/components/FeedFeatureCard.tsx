import { useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
} from 'react-native';

import { feedFont as font } from '../theme/tokens';
import { useLocalization } from '../localization/LocalizationProvider';

/** Content and availability of an SDK feature on the XLab home screen. */
interface FeedFeatureCardProps {
  category: string;
  watermark: string;
  /** Six-digit hex color for the card's accents. */
  accentColor: string;
  icon: ImageSourcePropType;
  /** Optional tint for a monochrome feature icon. */
  iconTintColor?: string;
  iconLabel: string;
  title: string;
  subtitle: string;
  tags: readonly string[];
  highlightedTag: string;
  /** Omit until the example is implemented; the card then shows a disabled state. */
  onPress?: () => void;
}

/** Shares the iOS feature-card layout across storage and rendering examples. */
export function FeedFeatureCard({
  category,
  watermark,
  accentColor,
  icon,
  iconTintColor,
  iconLabel,
  title,
  subtitle,
  tags,
  highlightedTag,
  onPress,
}: FeedFeatureCardProps) {
  const { t } = useLocalization();
  const accent = useMemo(
    () =>
      StyleSheet.create({
        background: { backgroundColor: accentColor },
        text: { color: accentColor },
        glow: { backgroundColor: `${accentColor}17` },
        dot: {
          backgroundColor: accentColor,
          boxShadow: `0 0 7px ${accentColor}CC`,
        },
        iconTile: {
          borderColor: `${accentColor}47`,
          backgroundImage: `linear-gradient(135deg, ${accentColor}47, rgba(27,23,18,0.28))`,
        },
      }),
    [accentColor],
  );

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}，${t(
        onPress ? 'feed.open' : 'feed.pending',
      )}`}
      accessibilityState={{ disabled: !onPress }}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View pointerEvents="none" style={[styles.glow, accent.glow]} />
      <View pointerEvents="none" style={[styles.stripe, accent.background]} />
      <Text accessible={false} style={styles.watermark}>
        {watermark}
      </Text>
      <View style={styles.header}>
        <View style={styles.categoryRow}>
          <View style={[styles.dot, accent.dot]} />
          <Text style={styles.category} numberOfLines={1} adjustsFontSizeToFit>
            {category}
          </Text>
        </View>
        <View style={styles.available}>
          <Text style={[styles.availableText, accent.text]}>
            {t(onPress ? 'feed.available' : 'feed.pending')}
          </Text>
        </View>
      </View>
      <View style={styles.middle}>
        <View style={[styles.iconTile, accent.iconTile]}>
          <Image
            source={icon}
            style={[
              styles.icon,
              iconTintColor ? { tintColor: iconTintColor } : undefined,
            ]}
          />
          <Text style={[styles.iconCaption, accent.text]}>{iconLabel}</Text>
        </View>
        <View style={styles.description}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={[styles.enter, accent.background]}>
          <Text style={styles.enterText}>
            {t(onPress ? 'feed.open' : 'feed.pendingAction')}
          </Text>
        </View>
      </View>
      <View style={styles.tags}>
        {tags.map(tag => (
          <View
            key={tag}
            style={[
              styles.tag,
              tag === highlightedTag && styles.highlightedTag,
            ]}
          >
            <Text
              style={[styles.tagText, tag === highlightedTag && accent.text]}
            >
              {tag}
            </Text>
          </View>
        ))}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.13)',
    backgroundImage:
      'linear-gradient(135deg, rgba(28,24,19,0.94), rgba(13,17,23,0.94), rgba(21,18,16,0.94))',
    boxShadow: '0 9px 20px rgba(0,0,0,0.52)',
    overflow: 'hidden',
  },
  pressed: { opacity: 0.75 },
  glow: {
    position: 'absolute',
    width: 126,
    height: 126,
    borderRadius: 63,
    right: -40,
    top: -52,
  },
  stripe: {
    position: 'absolute',
    left: 0,
    top: 47,
    width: 3,
    height: 54,
    borderRadius: 1.5,
  },
  watermark: {
    position: 'absolute',
    right: 16,
    bottom: -9,
    fontSize: font(45),
    fontWeight: '700',
    letterSpacing: -2,
    includeFontPadding: false,
    color: 'rgba(255,255,255,0.032)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  categoryRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  category: {
    flexShrink: 1,
    fontSize: font(9),
    fontWeight: '700',
    letterSpacing: 0.8,
    includeFontPadding: false,
    color: '#A99A8A',
  },
  available: {
    height: 25,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 12.5,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    backgroundColor: 'rgba(255,255,255,0.047)',
  },
  availableText: {
    fontSize: font(8),
    fontWeight: '700',
    letterSpacing: 0.7,
    includeFontPadding: false,
  },
  middle: { flexDirection: 'row', alignItems: 'center', marginTop: 15 },
  iconTile: {
    width: 48,
    height: 48,
    marginRight: 13,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: 'center',
    paddingTop: 7,
  },
  icon: { width: 24, height: 22, resizeMode: 'contain' },
  iconCaption: {
    fontSize: font(6),
    fontWeight: '700',
    letterSpacing: 0.5,
    includeFontPadding: false,
    marginTop: 1,
  },
  description: { flex: 1, gap: 5 },
  title: {
    fontSize: font(17),
    fontWeight: '700',
    includeFontPadding: false,
    color: '#F4F7FB',
  },
  subtitle: {
    fontSize: font(9.5),
    includeFontPadding: false,
    color: '#81786F',
  },
  enter: {
    width: 58,
    height: 34,
    borderRadius: 10,
    marginLeft: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  enterText: {
    fontSize: font(11),
    fontWeight: '700',
    includeFontPadding: false,
    color: '#08110E',
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  tag: {
    height: 24,
    paddingHorizontal: 9,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
    backgroundColor: 'rgba(8,12,18,0.4)',
  },
  highlightedTag: { backgroundColor: 'rgba(255,255,255,0.07)' },
  tagText: {
    fontSize: font(7),
    fontWeight: '700',
    includeFontPadding: false,
    color: '#A89A8B',
  },
});
