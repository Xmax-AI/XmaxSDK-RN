//
//  XmaxPackage.kt
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

package ai.xmax.reactnative
import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * A provider that registers the SDK runtime with React Native TurboModules.
 */
class XmaxPackage : BaseReactPackage() {

  /**
   * Provides a runtime instance only for the SDK's registered module name.
   *
   * @param name The module name requested by React Native.
   * @param context The application or React context used to access native services and resource
   *   directories.
   * @return The runtime for XmaxRuntime; null for other module names.
   */
  override fun getModule(
    name: String,
    context: ReactApplicationContext
  ): NativeModule? = if (name == XmaxRuntime.NAME) XmaxRuntime(context) else null

  /**
   * Provides metadata for lazy creation of the SDK TurboModule.
   */
  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      XmaxRuntime.NAME to ReactModuleInfo(
        XmaxRuntime.NAME,
        XmaxRuntime.NAME,
        false,
        false,
        false,
        true
      )
    )
  }
}
