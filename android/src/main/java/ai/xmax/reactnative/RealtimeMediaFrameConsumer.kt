//
//  RealtimeMediaFrameConsumer.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import java.lang.ref.WeakReference
import java.util.UUID

/**
 * An app-owned receiver for remote native media. Retain this object and pass nativeHandle to the
 * TypeScript listener setter. Remove the manager's listener before closing this consumer. A running
 * callback may finish after close; media bytes never cross JavaScript.
 * @param listener The background handler for owned remote packets.
 */
class RealtimeMediaFrameConsumer(
  listener: RealtimeMediaFrameListener
) : AutoCloseable {

  /**
   * The registry of app-retained native receivers.
   */
  companion object {

    /**
     * The lock protecting native handle lookup and invalidation.
     */
    private val lock = Any()

    /**
     * Weak entries keep receiver ownership with the app.
     */
    private val registry = mutableMapOf<String, WeakReference<RealtimeMediaFrameConsumer>>()

    /**
     * Resolves a live app-owned receiver for the supplied opaque handle.
     *
     * @param handle The opaque native receiver identity.
     */
    internal fun find(
      handle: String
    ): RealtimeMediaFrameConsumer? = synchronized(lock) {
      val consumer = registry[handle]?.get()
      if (consumer == null) registry.remove(handle)
      consumer
    }
  }

  /**
   * The nonreusable opaque handle supplied to the TypeScript registration API.
   */
  val nativeHandle: String = UUID.randomUUID().toString()

  /**
   * The application's callback, cleared permanently on close.
   */
  @Volatile private var listener: RealtimeMediaFrameListener? = listener

  init { synchronized(lock) { registry[nativeHandle] = WeakReference(this) } }

  /**
   * Permanently disables callbacks without waiting for an application callback already running.
   */
  override fun close() {
    listener = null
    synchronized(lock) { registry.remove(nativeHandle) }
  }

  /**
   * Delivers a current packet on the SDK's serial output queue.
   *
   * @param frame The owned packet from the active result binding.
   */
  internal fun receive(
    frame: RealtimeMediaFrame
  ) { listener?.invoke(frame) }
}
