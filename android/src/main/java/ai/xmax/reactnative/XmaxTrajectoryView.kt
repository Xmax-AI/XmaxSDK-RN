//
//  XmaxTrajectoryView.kt
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
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import android.view.Choreographer
import android.view.View
import android.view.ViewGroup
import org.json.JSONObject
import java.lang.ref.WeakReference
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * A view-owned native trajectory canvas that draws trails and fingertip animations in logical
 * viewport coordinates.
 *
 * @constructor Creates a trajectory canvas that owns its bitmap and animation callbacks.
 * @param context The application or React context used to access native services and resource
 *   directories.
 */
internal class XmaxTrajectoryView(
  context: Context
) : View(context), Choreographer.FrameCallback {

  /**
   * The current touch position, colors, and monotonic contact start time.
   *
   * @constructor Creates the position, colors, and start time for one touch.
   */
  private data class Finger(

    /**
     * The viewport horizontal coordinate, in logical layout units.
     */
    var x: Float,

    /**
     * The viewport vertical coordinate, in logical layout units.
     */
    var y: Float,

    /**
     * The trajectory center and highlighted trail color.
     */
    val core: Int,

    /**
     * The trajectory glow and outer trail color.
     */
    val glow: Int,

    /**
     * The monotonic contact start time, in seconds.
     */
    val began: Double
  )

  /**
   * The active touch identifiers and their latest positions, colors, and animation times.
   */
  private val fingers = linkedMapOf<String, Finger>()

  /**
   * The reusable paint for trajectory rings, glows, and segments.
   */
  private val paint = Paint(Paint.ANTI_ALIAS_FLAG)

  /**
   * The paint that fades trails by erasing opacity.
   */
  private val fadePaint = Paint().apply { xfermode = PorterDuffXfermode(PorterDuff.Mode.DST_OUT) }

  /**
   * The pixels per logical viewport unit; applied exactly once at the drawing boundary.
   */
  private val pixelScale = resources.displayMetrics.density

  /**
   * The offscreen trail bitmap, released or rebuilt when view resources or dimensions change.
   */
  private var bitmap: Bitmap? = null

  /**
   * The canvas associated with the trail bitmap.
   */
  private var trailCanvas: Canvas? = null

  /**
   * Whether the bitmap contains a trail that still needs to fade.
   */
  private var hasTrail = false

  /**
   * Whether a display-synchronized frame callback is pending.
   */
  private var scheduled = false

  /**
   * The monotonic time of the latest animation update, in seconds.
   */
  private var lastTick = 0.0

  /**
   * The monotonic time of the latest trail segment, in seconds.
   */
  private var lastMove = 0.0

  /**
   * The weak reference to the React Native container hosting the trajectory canvas.
   */
  private var host = WeakReference<ViewGroup>(null)

  /**
   * Updates trajectory canvas bounds when the validated host changes dimensions.
   */
  private val layoutListener = OnLayoutChangeListener {
    view, _, _, _, _, _, _, _, _ ->
      layout(
      0,
      0,
      view.width,
      view.height
    )
  }

  /**
   * Initializes the resource manager and registers the lifecycle or rendering services required by
   * this instance.
   */
  init {
    isClickable = false
    isFocusable = false
    importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
  }

  /**
   * Finds a mounted trajectory canvas and dispatches a drawing command.
   */
  companion object {

    /**
     * Applies a trajectory drawing command inside a validated container.
     *
     * @param host The validated React Native container hosting a trajectory or RTC canvas.
     * @param command The serialized trajectory drawing command.
     */
    fun renderIn(
      host: ViewGroup,
      command: String
    ) {
      val value = try { JSONObject(command) } catch (_: Exception) {
        return
      }
      var canvas = (0 until host.childCount).map { host.getChildAt(it) }.filterIsInstance<XmaxTrajectoryView>().firstOrNull()
      if (value.optString("action") == "detach") {
        canvas?.dispose()
        if (canvas != null) host.removeView(canvas)
        return
      }
      if (canvas == null) {
        canvas = XmaxTrajectoryView(host.context)
        canvas.host = WeakReference(host)
        host.addView(
          canvas,
          ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
          )
        )
        canvas.layout(
          0,
          0,
          host.width,
          host.height
        )
      }
      canvas.apply(value)
    }

    /**
     * Returns the monotonic animation time, in seconds.
     */
    private fun now() = System.nanoTime() / 1_000_000_000.0

    /**
     * Parses a trajectory color and uses the fallback when parsing fails.
     *
     * @param text The CSS color text to parse.
     * @param fallback The fallback value used when the color cannot be parsed.
     */
    private fun color(
      text: String,
      fallback: Int
    ): Int = try { Color.parseColor(text) } catch (_: IllegalArgumentException) {
      fallback
    }

    /**
     * Applies an opacity from 0 to 1 to a native color.
     *
     * @param color The native color used for this draw operation.
     * @param alpha The opacity, from 0 for transparent to 1 for opaque.
     */
    private fun alpha(
      color: Int,
      alpha: Double
    ): Int = (color and 0x00ffffff) or (
      (alpha.coerceIn(
          0.0,
          1.0
        ) * 255).toInt() shl 24
    )
  }

  /**
   * Executes a validated begin, move, end, reset, or detach drawing command.
   *
   * @param value The decoded drawing action and validated touch data.
   */
  private fun apply(
    value: JSONObject
  ) {
    when (val action = value.optString("action")) {
      "reset" -> {
        reset()
        return
      }
      "end" -> {
        val ids = value.optJSONArray("ids")
        if (ids != null) for (index in 0 until ids.length()) fingers.remove(ids.optString(index))
      }
      "begin", "move" -> {
        val points = value.optJSONArray("points")
        if (points != null) for (index in 0 until points.length()) {
          val point = points.optJSONObject(index) ?: continue
          val id = point.optString("id")
          val x = point.optDouble("x").toFloat()
          val y = point.optDouble("y").toFloat()
          if (!x.isFinite() || !y.isFinite()) continue
          val finger = fingers[id]
          if (action == "move" && finger != null) {
            drawSegment(
              finger,
              x,
              y
            )
            finger.x = x
            finger.y = y
          } else if (action == "begin") {
            fingers[id] = Finger(
              x,
              y,
              color(
                point.optString("core"),
                Color.WHITE
              ),
              color(
                point.optString("glow"),
                Color.GREEN
              ),
              now()
            )
          }
        }
      }
    }
    start()
    invalidate()
  }

  /**
   * Rebuilds the native trail bitmap for new pixel dimensions.
   *
   * @param w The new view width, in pixels.
   * @param h The new view height, in pixels.
   * @param oldw The previous view width, in pixels.
   * @param oldh The previous view height, in pixels.
   */
  override fun onSizeChanged(
    w: Int,
    h: Int,
    oldw: Int,
    oldh: Int
  ) {
    bitmap?.recycle()
    bitmap = null
    trailCanvas = null
    hasTrail = false
    if (w > 0 && h > 0) {
      val image = Bitmap.createBitmap(
        w,
        h,
        Bitmap.Config.ARGB_8888
      )
      bitmap = image
      trailCanvas = Canvas(image).apply { scale(
          pixelScale,
          pixelScale
        )
      }
    }
  }

  /**
   * Draws a trail segment using the current touch's center and glow colors.
   *
   * @param finger The touch colors and animation time used to draw the segment.
   * @param x The viewport horizontal coordinate, in logical layout units.
   * @param y The viewport vertical coordinate, in logical layout units.
   */
  private fun drawSegment(
    finger: Finger,
    x: Float,
    y: Float
  ) {
    val canvas = trailCanvas ?: return
    paint.reset()
    paint.isAntiAlias = true
    paint.strokeCap = Paint.Cap.ROUND
    paint.style = Paint.Style.STROKE
    for ((width, opacity, blur) in arrayOf(
        Triple(
          18f,
          0.22,
          12f
        ),
        Triple(
          10f,
          0.52,
          6f
        ),
        Triple(
          3f,
          0.82,
          0f
        )
    )) {
      paint.strokeWidth = width
      paint.color = alpha(
        if (width == 3f) finger.core else finger.glow,
        opacity
      )
      if (blur > 0) paint.setShadowLayer(
        blur,
        0f,
        0f,
        paint.color
      ) else paint.clearShadowLayer()
      canvas.drawLine(
        finger.x,
        finger.y,
        x,
        y,
        paint
      )
    }
    paint.clearShadowLayer()
    hasTrail = true
    lastMove = now()
  }

  /**
   * Starts display-synchronized animation only while the visible canvas contains touch points or
   * trails.
   */
  private fun start() {
    if (scheduled || !isAttachedToWindow || windowVisibility != VISIBLE || (fingers.isEmpty() && !hasTrail)) return
    scheduled = true
    lastTick = now()
    Choreographer.getInstance().postFrameCallback(this)
  }

  /**
   * Advances trail fading and schedules another frame only while the view is visible and an effect
   * remains active.
   *
   * @param frameTimeNanos The display frame's monotonic timestamp, in nanoseconds.
   */
  override fun doFrame(
    frameTimeNanos: Long
  ) {
    scheduled = false
    if (!isAttachedToWindow || windowVisibility != VISIBLE) {
      reset()
      return
    }
    val time = frameTimeNanos / 1_000_000_000.0
    if (hasTrail) {
      fadePaint.color = alpha(
        Color.BLACK,
        1 - 0.95.pow((time - lastTick).coerceAtLeast(0.0) * 60)
      )
      trailCanvas?.drawRect(
        0f,
        0f,
        width / pixelScale,
        height / pixelScale,
        fadePaint
      )
      if (time - lastMove > 64.0 / 60) {
        bitmap?.eraseColor(Color.TRANSPARENT)
        hasTrail = false
      }
    }
    lastTick = time
    invalidate()
    if (fingers.isNotEmpty() || hasTrail) {
      scheduled = true
      Choreographer.getInstance().postFrameCallback(this)
    }
  }

  /**
   * Draws trails and touch animations, applying logical viewport-to-pixel scaling exactly once.
   *
   * @param canvas The native drawing canvas for the current frame.
   */
  override fun onDraw(
    canvas: Canvas
  ) {
    bitmap?.let { canvas.drawBitmap(
        it,
        0f,
        0f,
        null
      )
    }
    canvas.save()
    canvas.scale(
      pixelScale,
      pixelScale
    )
    val time = now()
    for (finger in fingers.values) {
      val elapsed = time - finger.began
      val pulse = (sin(elapsed * 1.2 * PI * 2) + 1) / 2
      paint.reset()
      paint.isAntiAlias = true
      paint.style = Paint.Style.STROKE
      paint.strokeWidth = 2f
      for (index in 0..1) {
        val phase = if (index == 0) pulse else 1 - pulse
        paint.color = alpha(
          finger.glow,
          0.5 * (1 - index * 0.2) * (0.5 + phase * 0.5)
        )
        canvas.drawCircle(
          finger.x,
          finger.y,
          (14 + index * 18 + phase * 8).toFloat(),
          paint
        )
      }
      for (index in 0..3) {
        val direction = if (index % 2 == 0) 1 else -1
        val angle = index / 4.0 * PI * 2 + elapsed * 0.06 * direction
        glow(
          canvas,
          finger.x + cos(angle).toFloat() * 22,
          finger.y + sin(angle).toFloat() * 22,
          6f,
          finger.glow,
          0.6 * (0.6 + sin(elapsed * 3 + index) * 0.4)
        )
      }
      glow(
        canvas,
        finger.x,
        finger.y,
        (14 + pulse * 4).toFloat(),
        finger.glow,
        0.65 + pulse * 0.25
      )
      paint.shader = null
      paint.color = finger.core
      paint.style = Paint.Style.FILL
      canvas.drawCircle(
        finger.x,
        finger.y,
        5f,
        paint
      )
    }
    canvas.restore()
  }

  /**
   * Draws a radial glow with the specified center, radius, color, and opacity.
   *
   * @param canvas The native drawing canvas for the current frame.
   * @param x The viewport horizontal coordinate, in logical layout units.
   * @param y The viewport vertical coordinate, in logical layout units.
   * @param radius The radius, in logical layout units.
   * @param color The native color used for this draw operation.
   * @param opacity The opacity, from 0 for transparent to 1 for opaque.
   */
  private fun glow(
    canvas: Canvas,
    x: Float,
    y: Float,
    radius: Float,
    color: Int,
    opacity: Double
  ) {
    paint.reset()
    paint.isAntiAlias = true
    paint.shader = RadialGradient(
      x,
      y,
      radius,
      intArrayOf(
        alpha(
          color,
          opacity
        ),
        alpha(
          color,
          opacity * 0.6
        ),
        alpha(
          color,
          0.0
        )
      ),
      floatArrayOf(
        0f,
        0.4f,
        1f
      ),
      Shader.TileMode.CLAMP
    )
    canvas.drawCircle(
      x,
      y,
      radius,
      paint
    )
    paint.shader = null
  }

  /**
   * Clears touch points and trail pixels, then stops animation callbacks.
   */
  private fun reset() {
    Choreographer.getInstance().removeFrameCallback(this)
    scheduled = false
    fingers.clear()
    bitmap?.eraseColor(Color.TRANSPARENT)
    hasTrail = false
    invalidate()
  }

  /**
   * Stops animations, removes the container layout listener, and releases trail pixels.
   */
  private fun dispose() {
    reset()
    host.get()?.removeOnLayoutChangeListener(layoutListener)
    bitmap?.recycle()
    bitmap = null
    trailCanvas = null
  }

  /**
   * Restores the validated container's layout listener and prepares the mounted canvas's trail
   * bitmap.
   */
  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    host.get()?.addOnLayoutChangeListener(layoutListener)
    if (bitmap == null && width > 0 && height > 0) onSizeChanged(
      width,
      height,
      0,
      0
    )
  }

  /**
   * Releases trajectory animation and bitmap resources when the canvas is detached.
   */
  override fun onDetachedFromWindow() {
    dispose()
    super.onDetachedFromWindow()
  }

  /**
   * Clears animations when the canvas becomes invisible.
   *
   * @param visibility The native view visibility state used to pause invisible animations.
   */
  override fun onWindowVisibilityChanged(
    visibility: Int
  ) {
    super.onWindowVisibilityChanged(visibility)
    if (visibility != VISIBLE) reset()
  }
}
