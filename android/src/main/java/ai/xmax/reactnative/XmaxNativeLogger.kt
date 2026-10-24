//
//  XmaxNativeLogger.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import android.util.Log

/**
 * A logger that filters SDK entries by category before writing native output.
 */
internal object XmaxNativeLogger {

  /**
   * The enabled log category bitmask; 0 disables logging.
   */
  private var options = 0

  /**
   * Replaces the global native log category bitmask.
   *
   * @param value The log category bitmask; 0 disables native logging.
   */
  @Synchronized fun configure(
    value: Int
  ) {
    options = if (value in 0..3) value else 0
  }

  /**
   * Writes an enabled, formatted SDK log entry without triggering a JavaScript console error.
   *
   * @param level The log level: debug, info, warn, or error.
   * @param message The formatted log message.
   * @param option The current message's log-category bitmask.
   */
  @Synchronized fun write(
    level: String,
    message: String,
    option: Int
  ) {
    if (option <= 0 || options and option != option) return

    when (level) {
      "debug" -> Log.d(
        "XmaxSDK",
        message
      )
      "info" -> Log.i(
        "XmaxSDK",
        message
      )
      "warn" -> Log.w(
        "XmaxSDK",
        message
      )
      "error" -> Log.e(
        "XmaxSDK",
        message
      )
    }
  }
}
