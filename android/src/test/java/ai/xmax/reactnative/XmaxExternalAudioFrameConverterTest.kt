package ai.xmax.reactnative

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.*
import org.junit.Test

class XmaxExternalAudioFrameConverterTest {
  private fun pcm(count: Int, value: Short = 1000, channels: Int = 1): ByteBuffer =
    ByteBuffer.allocate(count * channels * 2).order(ByteOrder.LITTLE_ENDIAN).apply {
      repeat(count * channels) { putShort(value) }
      flip()
    }

  @Test fun completePacketsRetainTimelineAndOwnTheirBytes() {
    val converter = XmaxExternalAudioFrameConverter()
    val packets = mutableListOf<Pair<ByteArray, Long>>()
    val input = pcm(960)
    converter.append(input, 48000, 1, 1000000) { data, time -> packets.add(data to time) }
    input.clear(); while (input.hasRemaining()) input.put(0.toByte())
    assertEquals(listOf(1000000L, 1010000L), packets.map { it.second })
    assertTrue(packets.all { it.first.size == 960 })
    assertEquals(1000.toShort(), ByteBuffer.wrap(packets[0].first).order(ByteOrder.LITTLE_ENDIAN).short)
  }

  @Test fun gapsAndOverlapsDoNotInsertSilenceOrMixOldPartialSamples() {
    val converter = XmaxExternalAudioFrameConverter()
    val packets = mutableListOf<Pair<ByteArray, Long>>()
    val receive = { data: ByteArray, time: Long -> packets.add(data to time); Unit }
    converter.append(pcm(240, 3), 48000, 1, 1000000, receive)
    converter.append(pcm(240, 9), 48000, 1, 1000000, receive)
    assertTrue(packets.isEmpty())
    converter.append(pcm(480, 7), 48000, 1, 2000000, receive)
    assertEquals(1, packets.size)
    assertEquals(2000000L, packets[0].second)
    assertEquals(7.toShort(), ByteBuffer.wrap(packets[0].first).order(ByteOrder.LITTLE_ENDIAN).short)
  }

  @Test fun discardingPreviewAudioPreservesFormatAndTimestampValidation() {
    val converter = XmaxExternalAudioFrameConverter()
    val packets = mutableListOf<ByteArray>()
    val receive = { data: ByteArray, _: Long -> packets.add(data); Unit }
    converter.append(pcm(240, 3), 48000, 1, 1000000, receive)
    converter.discardPendingAudio()
    assertThrows(IllegalArgumentException::class.java) {
      converter.append(pcm(480, 7, 2), 48000, 2, 1010000, receive)
    }
    converter.append(pcm(480, 7), 48000, 1, 1000000, receive)
    assertTrue(packets.isEmpty())
    converter.append(pcm(480, 7), 48000, 1, 1005000, receive)
    assertEquals(1, packets.size)
    assertEquals(7.toShort(), ByteBuffer.wrap(packets[0]).order(ByteOrder.LITTLE_ENDIAN).short)
  }

  @Test fun stereoResamplingProducesMonotonicOwnedMonoPackets() {
    val converter = XmaxExternalAudioFrameConverter()
    val packets = mutableListOf<Pair<ByteArray, Long>>()
    converter.append(pcm(4410, 1000, 2), 44100, 2, 2000000) { data, time -> packets.add(data to time) }
    assertTrue(packets.size >= 9)
    assertTrue(packets.all { it.first.size == 960 })
    for (index in packets.indices) {
      assertEquals(2000000L + index * 10000L, packets[index].second)
      assertEquals(1000.toShort(), ByteBuffer.wrap(packets[index].first).order(ByteOrder.LITTLE_ENDIAN).short)
    }
  }

  @Test fun invalidTimestampsAreIgnoredAndTruncatedPCMIsRejected() {
    val converter = XmaxExternalAudioFrameConverter()
    converter.append(pcm(480), 48000, 1, -1) { _, _ -> fail("Invalid timestamp delivered") }
    assertThrows(IllegalArgumentException::class.java) {
      converter.append(ByteBuffer.allocate(3), 48000, 1, 0) { _, _ -> fail("Partial PCM delivered") }
    }
  }
}
