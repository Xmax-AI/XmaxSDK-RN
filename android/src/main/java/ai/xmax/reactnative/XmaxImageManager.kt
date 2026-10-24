//
//  XmaxImageManager.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.RectF
import android.media.ExifInterface
import android.net.Uri
import com.facebook.react.bridge.Promise
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * A service that reads image metadata and manages private upright copies without deleting
 * caller-owned originals.
 *
 * @constructor Creates a serial image service that manages private copy ownership.
 * @param context The application or React context used to access native services and resource
 *   directories.
 */
internal class XmaxImageManager(

  /**
   * The application or React context used for native services and cache directories.
   */
  private val context: Context
) {

  /**
   * The serial executor for reading image metadata and converting formats.
   */
  private val executor = Executors.newSingleThreadExecutor()

  /**
   * The private cache directory containing only SDK image copies.
   */
  private val directory = File(
    context.cacheDir,
    "xmax-images"
  )

  /**
   * The image copy paths created and eligible for cleanup by this service.
   */
  private val owned = mutableSetOf<File>()

  /**
   * Whether the native resource manager has been permanently invalidated.
   */
  private var invalidated = false

  /**
   * Opens a local file or content URI for metadata reads and image conversion.
   *
   * @param value The readable local file URL, absolute path, or supported content URI.
   * @return The readable input stream, closed by the image operation after reading or decoding.
   */
  private fun open(
    value: String
  ): InputStream {
    val uri = if (value.startsWith("/")) Uri.fromFile(File(value)) else Uri.parse(value)
    require(uri.scheme == "file" || uri.scheme == "content") {
      "A local image URI is required"
    }

    return requireNotNull(context.contentResolver.openInputStream(uri)) {
      "Unable to open image"
    }
  }

  /**
   * Reads image EXIF orientation for upright dimensions and pixel conversion.
   *
   * @param value The readable local file URL, absolute path, or supported content URI.
   * @return The image EXIF orientation value.
   */
  private fun orientation(
    value: String
  ): Int = open(value).use {
    try {
      ExifInterface(it).getAttributeInt(
        ExifInterface.TAG_ORIENTATION,
        ExifInterface.ORIENTATION_NORMAL
      )
    } catch (_: java.io.IOException) {
      ExifInterface.ORIENTATION_NORMAL
    }
  }

  /**
   * Reads upright image dimensions without allocating a full-resolution bitmap.
   *
   * @param value The readable local file URL, absolute path, or supported content URI.
   * @return The orientation-corrected image dimensions, in pixels.
   */
  private fun bounds(
    value: String
  ): BitmapFactory.Options {
    val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(value).use {
      BitmapFactory.decodeStream(
        it,
        null,
        options
      )
    }
    require(options.outWidth > 0 && options.outHeight > 0) {
      "Unable to read image dimensions"
    }

    return options
  }

  /**
   * Asynchronously reads orientation-corrected dimensions without transferring image pixels to
   * JavaScript.
   *
   * Resolves the Promise with JSON containing upright dimensions; rejects failures with an SDK
   * error code.
   *
   * @param value The readable local file URL, absolute path, or supported content URI.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  fun info(
    value: String,
    promise: Promise
  ) {
    executor.execute {
      try {
        val bounds = bounds(value)
        val rotated = orientation(value) in 5..8
        promise.resolve(
          JSONObject()
            .put(
            "width",
            if (rotated) bounds.outHeight else bounds.outWidth
          )
            .put(
            "height",
            if (rotated) bounds.outWidth else bounds.outHeight
          ).toString()
        )
      } catch (error: Exception) {
        promise.reject(
          "MEDIA_ERROR",
          error
        )
      }
    }
  }

  /**
   * Creates a private upright JPEG at the target dimensions and records ownership for subsequent
   * cleanup.
   *
   * Resolves the Promise with the private JPEG URL; rejects failures with an SDK error code.
   *
   * @param value The readable local file URL, absolute path, or supported content URI.
   * @param width The width, in pixels.
   * @param height The height, in pixels.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  fun prepare(
    value: String,
    width: Double,
    height: Double,
    promise: Promise
  ) {
    executor.execute {
      var decoded: Bitmap? = null
      var oriented: Bitmap? = null
      var output: Bitmap? = null
      var file: File? = null

      try {
        // MediaService must calculate model format and pixel limits before preparation.
        require(
          width.isFinite() && height.isFinite() && width > 0 && height > 0 &&
          width % 1 == 0.0 && height % 1 == 0.0
        ) {
          "Invalid prepared image dimensions"
        }
        val bounds = bounds(value)
        val options = BitmapFactory.Options().apply {
          inPreferredConfig = Bitmap.Config.ARGB_8888
          inSampleSize = 1
          while (max(bounds.outWidth, bounds.outHeight) / inSampleSize > 4096) inSampleSize *= 2
        }
        decoded = open(value).use {
          BitmapFactory.decodeStream(
            it,
            null,
            options
          )
        }
          ?: error("Unable to decode image")
        val transform = Matrix().apply {
          when (orientation(value)) {
            2 -> setScale(
              -1f,
              1f
            )
            3 -> setRotate(180f)
            4 -> setScale(
              1f,
              -1f
            )
            5 -> {
              setRotate(90f)
              postScale(
                -1f,
                1f
              )
            }
            6 -> setRotate(90f)
            7 -> {
              setRotate(-90f)
              postScale(
                -1f,
                1f
              )
            }
            8 -> setRotate(-90f)
          }
        }
        oriented = Bitmap.createBitmap(
          decoded,
          0,
          0,
          decoded.width,
          decoded.height,
          transform,
          true
        )
        output = Bitmap.createBitmap(
          width.toInt(),
          height.toInt(),
          Bitmap.Config.ARGB_8888
        )
        val scale = max(width / oriented.width, height / oriented.height).toFloat()
        val left = (width.toFloat() - oriented.width * scale) / 2
        val top = (height.toFloat() - oriented.height * scale) / 2
        Canvas(output).apply {
          drawColor(Color.BLACK)
          drawBitmap(
            oriented,
            null,
            RectF(
              left,
              top,
              left + oriented.width * scale,
              top + oriented.height * scale
            ),
            Paint(Paint.FILTER_BITMAP_FLAG)
          )
        }
        check(directory.isDirectory || directory.mkdirs()) {
          "Unable to create image cache"
        }
        file = File(
          directory,
          "${UUID.randomUUID()}.jpg"
        )
        file.outputStream().use {
          check(
            output.compress(
              Bitmap.CompressFormat.JPEG,
              95,
              it
            )
          ) {
            "Unable to save image"
          }
        }
        synchronized(this) {
          check(!invalidated) {
            "Image runtime has been released"
          }
          owned.add(file)
        }
        promise.resolve(Uri.fromFile(file).toString())
      } catch (error: Exception) {
        file?.delete()
        promise.reject(
          "MEDIA_ERROR",
          error
        )
      } catch (error: OutOfMemoryError) {
        file?.delete()
        promise.reject(
          "MEDIA_ERROR",
          "Insufficient memory to prepare this image",
          error
        )
      } finally {
        output?.recycle()
        if (oriented !== decoded) oriented?.recycle()
        decoded?.recycle()
      }
    }
  }

  /**
   * Deletes only image copies owned by this service; an already absent copy is treated as
   * successfully removed.
   *
   * Completes after copy cleanup; failures reject the Promise with an SDK error code.
   *
   * @param value The SDK-owned private image copy URL returned by image preparation.
   * @param promise The React Native Promise resolved or rejected when the asynchronous native
   *   operation completes.
   */
  fun remove(
    value: String,
    promise: Promise
  ) {
    executor.execute {
      try {
        val file = File(requireNotNull(Uri.parse(value).path)).canonicalFile
        require(file.parentFile == directory.canonicalFile && file.extension == "jpg") {
          "Image is outside SDK cache"
        }
        check(!file.exists() || file.delete()) {
          "Unable to remove prepared image"
        }
        synchronized(this) {
          owned.remove(file)
        }

        promise.resolve(null)
      } catch (error: Exception) {
        promise.reject(
          "MEDIA_ERROR",
          error
        )
      }
    }
  }

  /**
   * Stops native work and releases current resources without cancelling caller-owned file or
   * transfer operations.
   */
  @Synchronized fun invalidate() {
    invalidated = true
    owned.forEach { it.delete() }
    owned.clear()
    executor.shutdown()
  }
}
