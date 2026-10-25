//
//  RtcRemoteAudioSink.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import io.agora.rtc2.IAudioFrameObserver
import io.agora.rtc2.audio.AudioParams
import java.nio.ByteBuffer

/**
 * Observes individual remote PCM without modifying playback or enabling local input.
 */
internal class RtcRemoteAudioSink(

  /**
   * The observer filtering copied packets to the active result binding.
   */
  private val output: XmaxRemoteFrameObserver
) : IAudioFrameObserver {

  /**
   * Preserves audio outside the requested pre-mix observation position.
   * @param channelId The RTC room supplying the packet.
   * @param type The native PCM frame type.
   * @param samplesPerChannel The samples in each channel.
   * @param bytesPerSample The bytes per PCM sample.
   * @param channels The interleaved channel count.
   * @param samplesPerSec The sample rate, in hertz.
   * @param buffer The borrowed native PCM bytes.
   * @param renderTimeMs The receiver rendering clock, in milliseconds.
   * @param avsyncType The native synchronization mode.
   * @return True, preserving the unmodified audio.
   */
  override fun onRecordAudioFrame(
    channelId: String?,
    type: Int,
    samplesPerChannel: Int,
    bytesPerSample: Int,
    channels: Int,
    samplesPerSec: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long,
    avsyncType: Int
  ): Boolean = true

  /**
   * Preserves audio outside the requested pre-mix observation position.
   * @param channelId The RTC room supplying the packet.
   * @param type The native PCM frame type.
   * @param samplesPerChannel The samples in each channel.
   * @param bytesPerSample The bytes per PCM sample.
   * @param channels The interleaved channel count.
   * @param samplesPerSec The sample rate, in hertz.
   * @param buffer The borrowed native PCM bytes.
   * @param renderTimeMs The receiver rendering clock, in milliseconds.
   * @param avsyncType The native synchronization mode.
   * @return True, preserving the unmodified audio.
   */
  override fun onPlaybackAudioFrame(
    channelId: String?,
    type: Int,
    samplesPerChannel: Int,
    bytesPerSample: Int,
    channels: Int,
    samplesPerSec: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long,
    avsyncType: Int
  ): Boolean = true

  /**
   * Preserves audio outside the requested pre-mix observation position.
   * @param channelId The RTC room supplying the packet.
   * @param type The native PCM frame type.
   * @param samplesPerChannel The samples in each channel.
   * @param bytesPerSample The bytes per PCM sample.
   * @param channels The interleaved channel count.
   * @param samplesPerSec The sample rate, in hertz.
   * @param buffer The borrowed native PCM bytes.
   * @param renderTimeMs The receiver rendering clock, in milliseconds.
   * @param avsyncType The native synchronization mode.
   * @return True, preserving the unmodified audio.
   */
  override fun onMixedAudioFrame(
    channelId: String?,
    type: Int,
    samplesPerChannel: Int,
    bytesPerSample: Int,
    channels: Int,
    samplesPerSec: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long,
    avsyncType: Int
  ): Boolean = true

  /**
   * Preserves audio outside the requested pre-mix observation position.
   * @param type The native PCM frame type.
   * @param samplesPerChannel The samples in each channel.
   * @param bytesPerSample The bytes per PCM sample.
   * @param channels The interleaved channel count.
   * @param samplesPerSec The sample rate, in hertz.
   * @param buffer The borrowed native PCM bytes.
   * @param renderTimeMs The receiver rendering clock, in milliseconds.
   * @param avsyncType The native synchronization mode.
   * @return True, preserving the unmodified audio.
   */
  override fun onEarMonitoringAudioFrame(
    type: Int,
    samplesPerChannel: Int,
    bytesPerSample: Int,
    channels: Int,
    samplesPerSec: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long,
    avsyncType: Int
  ): Boolean = true

  /**
   * Copies requested result PCM before mixing, preserving native playback.
   * @param channelId The RTC room supplying the packet.
   * @param uid The remote result account.
   * @param type The native PCM frame type.
   * @param samplesPerChannel The samples in each channel.
   * @param bytesPerSample The bytes per PCM sample.
   * @param channels The interleaved channel count.
   * @param samplesPerSec The sample rate, in hertz.
   * @param buffer The borrowed native PCM bytes.
   * @param renderTimeMs The receiver rendering clock, in milliseconds.
   * @param avsyncType The native synchronization mode.
   * @param rtpTimestamp The transport timestamp, unused for output scheduling.
   * @param presentationMs The source presentation timestamp, unused for receiver scheduling.
   * @return True, preserving the unmodified audio.
   */
  override fun onPlaybackAudioFrameBeforeMixing(
    channelId: String?,
    uid: Int,
    type: Int,
    samplesPerChannel: Int,
    bytesPerSample: Int,
    channels: Int,
    samplesPerSec: Int,
    buffer: ByteBuffer?,
    renderTimeMs: Long,
    avsyncType: Int,
    rtpTimestamp: Int,
    presentationMs: Long
  ): Boolean {
    output.audio(
      channelId,
      uid,
      samplesPerChannel,
      bytesPerSample,
      channels,
      samplesPerSec,
      buffer,
      renderTimeMs
    )
    return true
  }

  /**
   * Returns the read-only 48 kHz mono PCM configuration for unobserved audio positions.
   */
  override fun getRecordAudioParams(): AudioParams = AudioParams(
    48000,
    1,
    0,
    480
  )

  /**
   * Returns the read-only 48 kHz mono PCM configuration for unobserved audio positions.
   */
  override fun getPlaybackAudioParams(): AudioParams = AudioParams(
    48000,
    1,
    0,
    480
  )

  /**
   * Returns the read-only 48 kHz mono PCM configuration for unobserved audio positions.
   */
  override fun getMixedAudioParams(): AudioParams = AudioParams(
    48000,
    1,
    0,
    480
  )

  /**
   * Returns the read-only 48 kHz mono PCM configuration for unobserved audio positions.
   */
  override fun getEarMonitoringAudioParams(): AudioParams = AudioParams(
    48000,
    1,
    0,
    480
  )

  /**
   * Observes only the subscribed remote user before audio mixing.
   */
  override fun getObservedAudioFramePosition(): Int = 8
}
