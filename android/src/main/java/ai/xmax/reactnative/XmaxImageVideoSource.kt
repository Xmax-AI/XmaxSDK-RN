//
//  XmaxImageVideoSource.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.SystemClock
import com.facebook.react.bridge.Promise
import io.agora.rtc2.RtcEngine
import io.agora.rtc2.video.AgoraVideoFrame
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * A source that decodes and repeatedly sends image frames on a serial native queue with a new
 * timestamp per frame. Submission stops when resources are released.
 *
 * @constructor Creates a serial image frame queue using the shared resource lock.
 * @param gate The runtime resource lock that prevents frame submission from overlapping engine
 *   destruction.
 * @param directory The private directory for SDK image copies.
 */
internal class XmaxImageVideoSource(

  /**
   * The resource lock shared by media startup, frame submission, and release.
   */
  private val gate: Any,

  /**
   * The private cache directory containing only SDK image copies.
   */
  private val directory: File
) {

  /**
   * The serial queue for image decoding and scheduled frame submission.
   */
  private val worker = Executors.newSingleThreadScheduledExecutor()

  /**
   * The source revision used to reject stale decoding results and scheduled tasks after stopping.
   */
  private var generation = 0L

  /**
   * The scheduled frame task, cleared before the native engine is destroyed.
   */
  private var timer: ScheduledFuture<*>? = null

  /**
   * Decodes a prepared image and schedules repeated frame submission only while resource ownership
   * remains valid.
   *
   * Completes after decoding and frame scheduling; failures reject the Promise with an SDK error
   * code.
   *
   * @param engine The RTC engine that reports events or receives frames.
   * @param path The absolute path of an SDK JPEG copy in the private image cache.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   * @param fps The frame rate, in fps.
   * @param active The check that determines whether decoding or frame submission still belongs to
   *   the current foreground media owner.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  fun start(
    engine: RtcEngine,
    path: String,
    width: Int,
    height: Int,
    fps: Int,
    active: () -> Boolean,
    promise: Promise,
  ) {
    require(
      XmaxImageVideoFormat.isValid(
        width.toDouble(),
        height.toDouble(),
        fps.toDouble()
      )
    )

    val token = synchronized(gate) {
      stop()
      generation
    }

    worker.execute {
      try {
        val file = File(path).canonicalFile
        require(file.parentFile == directory.canonicalFile && file.extension == "jpg") {
          "Image source must be a prepared SDK image"
        }
        val options = BitmapFactory.Options().apply {
          inPreferredConfig = Bitmap.Config.ARGB_8888
          inScaled = false
        }
        val bitmap = requireNotNull(
          BitmapFactory.decodeFile(
            file.path,
            options
          )
        ) {
          "Unable to decode prepared image"
        }
        val pixels: ByteBuffer
        val stride: Int

        try {
          require(bitmap.width == width && bitmap.height == height) {
            "Prepared image dimensions do not match the video format"
          }
          stride = bitmap.rowBytes
          pixels = ByteBuffer.allocateDirect(bitmap.byteCount)
          bitmap.copyPixelsToBuffer(pixels)
          pixels.rewind()
        } finally {
          bitmap.recycle()
        }

        synchronized(gate) {
          check(token == generation && active()) {
            "Image source was cancelled"
          }

          val buffer = ByteArray(width * height * 4)
          for (row in 0 until height) {
            pixels.position(row * stride)
            pixels.get(
              buffer,
              row * width * 4,
              width * 4
            )
          }

          /**
           * Submits an immutable image frame to the current native RTC engine.
           */
          fun push() {
            val frame = AgoraVideoFrame().apply {
              format = AgoraVideoFrame.FORMAT_RGBA
              timeStamp = SystemClock.elapsedRealtime()
              this.stride = width
              this.height = height
              rotation = 0
              buf = buffer
            }
            engine.pushExternalVideoFrame(frame)
          }

          push()
          val interval = 1_000_000_000L / fps
          timer = worker.scheduleWithFixedDelay(
            {
              synchronized(gate) {
                if (token == generation && active()) {
                  try {
                    push()
                  } catch (error: Exception) {
                    // Exception messages may contain file paths; logs include only restricted details.
                    XmaxNativeLogger.write(
                      "error",
                      "[Xmax][Media] Native image frame delivery failed",
                      1
                    )
                    stop()
                  }
                }
              }
            },
            interval,
            interval,
            TimeUnit.NANOSECONDS
          )

          promise.resolve(null)
        }
      } catch (error: Exception) {
        promise.reject(
          "MEDIA_ERROR",
          error
        )
      } catch (error: OutOfMemoryError) {
        promise.reject(
          "MEDIA_ERROR",
          "Insufficient memory for image video source",
          error
        )
      }
    }
  }

  /**
   * Stops scheduled frame submission and invalidates pending decoding results before engine
   * release.
   */
  fun stop() = synchronized(gate) {
    generation++
    timer?.cancel(false)
    timer = null
  }

  /**
   * Stops native work and releases current resources without cancelling caller-owned file or
   * transfer operations.
   */
  fun invalidate() = synchronized(gate) {
    stop()
    worker.shutdown()
  }
}
