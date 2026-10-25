import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { RecordingState } from './RemoteMediaFrameReception';
import { useLocalization } from '../localization/LocalizationProvider';

/** Displays the supported camera or file actions above realtime preview. */
export function RealtimeToolbar({
  camera,
  external,
  canFlip,
  picking,
  statisticsVisible,
  muted,
  recording,
  recordingState,
  onRecording,
  top,
  right,
  onFlip,
  onStatistics,
  onVolume,
  onMute,
  onGallery,
}: {
  camera: boolean;
  external: boolean;
  canFlip: boolean;
  picking: boolean;
  statisticsVisible: boolean;
  muted: boolean;
  recording: boolean;
  recordingState: RecordingState;
  onRecording: () => void;
  top: number;
  right: number;
  onFlip: () => void;
  onStatistics: () => void;
  onVolume: () => void;
  onMute: () => void;
  onGallery: () => void;
}) {
  const { t } = useLocalization();
  const statistics = (
    <Action
      camera={camera}
      title={t('realtime.statistics.title')}
      icon={require('../assets/realtime/realtime_statistics.png')}
      selected={statisticsVisible}
      onPress={onStatistics}
    />
  );
  const volume = (
    <Action
      camera={camera}
      title={t('realtime.volume')}
      label={t('realtime.volume.remote.adjust')}
      icon={require('../assets/realtime/realtime_volume.png')}
      onPress={onVolume}
    />
  );
  const record = recording && (
    <Action
      camera={camera}
      title={t(
        recordingState === 'recording'
          ? 'record.stop'
          : recordingState === 'preparing'
          ? 'record.prepare'
          : recordingState === 'saving'
          ? 'record.save'
          : 'record.title',
      )}
      label={t(
        recordingState === 'recording'
          ? 'record.stopSave'
          : recordingState === 'preparing'
          ? 'record.preparing.label'
          : recordingState === 'saving'
          ? 'record.saving.label'
          : 'record.start',
      )}
      icon={
        recordingState === 'recording'
          ? require('../assets/realtime/realtime_record_stop.png')
          : recordingState === 'idle'
          ? require('../assets/realtime/realtime_record.png')
          : require('../assets/realtime/realtime_record_busy.png')
      }
      value={t(
        recordingState === 'idle'
          ? 'record.idle'
          : recordingState === 'preparing'
          ? 'record.preparing'
          : recordingState === 'saving'
          ? 'record.saving'
          : 'record.recording',
      )}
      tint={
        recordingState === 'recording'
          ? '#FF3B30'
          : recordingState === 'idle'
          ? '#FFF'
          : '#FF9500'
      }
      disabled={recordingState === 'preparing' || recordingState === 'saving'}
      onPress={onRecording}
    />
  );
  return (
    <View
      style={[
        styles.toolbar,
        camera ? styles.camera : styles.media,
        { top: top + (camera ? 6 : 5), right: right + (camera ? 8 : 12) },
      ]}
    >
      {camera ? (
        <>
          <Action
            camera
            title={t('realtime.flip')}
            label={t('realtime.flipCamera')}
            icon={require('../assets/realtime/realtime_camera_rotate.png')}
            disabled={!canFlip}
            onPress={onFlip}
          />
          {volume}
          {statistics}
          {record}
        </>
      ) : (
        <>
          {statistics}
          {record}
          {external && volume}
          {external && (
            <Action
              title={t(muted ? 'realtime.mute' : 'realtime.sound')}
              label={t(
                muted ? 'realtime.sound.enable' : 'realtime.sound.disable',
              )}
              icon={
                muted
                  ? require('../assets/realtime/realtime_muted.png')
                  : require('../assets/realtime/realtime_sound.png')
              }
              onPress={onMute}
            />
          )}
          <Action
            title={t('realtime.photos')}
            label={t('realtime.photos.replace')}
            icon={require('../assets/realtime/realtime_photos.png')}
            disabled={picking}
            onPress={onGallery}
          />
        </>
      )}
    </View>
  );
}

/** An icon and label sharing one accessible action target. */
function Action({
  camera = false,
  title,
  label = title,
  icon,
  selected = false,
  tint,
  value,
  disabled = false,
  onPress,
}: {
  camera?: boolean;
  title: string;
  label?: string;
  icon: number;
  selected?: boolean;
  tint?: string;
  value?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      accessibilityValue={value ? { text: value } : undefined}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        camera ? styles.cameraAction : styles.mediaAction,
        (pressed || disabled) && styles.dimmed,
      ]}
    >
      <Image
        source={icon}
        style={[
          styles.icon,
          camera ? styles.cameraIcon : styles.mediaIcon,
          selected && styles.selected,
          tint ? { tintColor: tint } : undefined,
        ]}
      />
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.8}
        style={[styles.label, !camera && styles.mediaLabel]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: { position: 'absolute' },
  camera: { width: 58 },
  media: { flexDirection: 'row', height: 50 },
  action: { alignItems: 'center' },
  cameraAction: { width: 58, height: 62, paddingTop: 9 },
  mediaAction: { width: 48, height: 50, paddingTop: 5 },
  icon: {
    resizeMode: 'contain',
    tintColor: '#FFF',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
  },
  cameraIcon: { width: 22, height: 22 },
  mediaIcon: { width: 28, height: 22 },
  label: {
    marginTop: 5,
    fontSize: 11,
    fontWeight: '600',
    color: '#FFF',
    includeFontPadding: false,
    textShadowColor: '#0008',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
  mediaLabel: { marginTop: 2, fontSize: 10 },
  selected: { tintColor: '#007AFF' },
  dimmed: { opacity: 0.55 },
});
