package ai.xmax.reactnative

import org.junit.Assert.*
import org.junit.Test

class RemoteVideoTimelineTest {
  @Test fun nativeUnixRenderTimeTakesPrecedenceOverMonotonicPresentationTime() {
    val clock = RemoteVideoTimeline({ 1_792_000_000_000L }, { 5_000_000_000L })
    clock.reset()
    assertEquals(1_792_000_000_123_000L, clock.presentationTimeUs(1_792_000_000_123L, 5_999_000_000L))
  }

  @Test fun absentRenderTimeUsesOneStableUnixMappingIncludingEarlierVideoPTS() {
    var wall = 1_792_000_000_000L
    var monotonic = 5_000_000_000L
    val clock = RemoteVideoTimeline({ wall }, { monotonic })
    clock.reset()
    assertEquals(1_791_999_999_950_000L, clock.presentationTimeUs(0, 4_950_000_000L))
    wall += 60000
    monotonic += 10_000_000L
    assertEquals(1_792_000_000_010_000L, clock.presentationTimeUs(0, 5_010_000_000L))
    clock.reset()
    assertEquals(1_792_000_060_000_000L, clock.presentationTimeUs(0, monotonic))
  }

  @Test fun invalidTimestampsCannotOverflowOrInventVideoPresentationTimes() {
    val clock = RemoteVideoTimeline({ 1_792_000_000_000L }, { 5_000_000_000L })
    assertNull(clock.presentationTimeUs(0, 5_000_000_000L))
    clock.reset()
    assertNull(clock.presentationTimeUs(0, 0))
    assertNull(clock.presentationTimeUs(0, -1))
    assertNull(clock.presentationTimeUs(Long.MAX_VALUE, 5_000_000_000L))
  }
}
