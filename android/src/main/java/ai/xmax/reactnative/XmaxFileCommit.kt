//
//  XmaxFileCommit.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative

import java.nio.file.Files
import java.nio.file.LinkOption
import java.nio.file.Paths
import java.nio.file.StandardCopyOption

/**
 * An operation that atomically replaces a completed download in the same directory without first
 * deleting the destination.
 */
internal object XmaxFileCommit {

  /**
   * Atomically replaces the destination with a completed regular temporary file in the same
   * directory, preserving the original destination on failure.
   *
   * @param sourcePath The absolute path of the completed temporary file.
   * @param destinationPath The absolute destination path in the temporary file's directory.
   */
  fun replace(
    sourcePath: String,
    destinationPath: String
  ) {
    val source = Paths.get(sourcePath).normalize()
    val destination = Paths.get(destinationPath).normalize()
    require(
      source.isAbsolute && destination.isAbsolute && source != destination &&
      source.parent == destination.parent && Files.isRegularFile(
        source,
        LinkOption.NOFOLLOW_LINKS
      )
    ) {
      "Expected a completed file beside its destination"
    }
    Files.move(
      source,
      destination,
      StandardCopyOption.ATOMIC_MOVE,
      StandardCopyOption.REPLACE_EXISTING
    )
  }
}
