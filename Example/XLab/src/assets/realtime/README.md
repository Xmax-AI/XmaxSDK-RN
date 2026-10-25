# Realtime 参考图资源

复制自 iOS XmaxSDK 当前工作区 `Examples/XLab/XLab/Resources/Assets.xcassets`，2026-09-10：

- `RealtimeReferenceCatalog.dataset/RealtimeReferenceCatalog.json`：原样保留 51 条预设的 ID、分类、标题、缩略图 URL、提示词和 referencePath。换形象 12、换装 12、虚拟召唤 12、换风格 15。
- `realtime_add_reference.imageset/realtime_add_reference.png`：固定添加参考图按钮。
- `realtime_prompt_add.imageset/realtime_prompt_add.png`：自由模式添加按钮。
- `realtime_prompt_submit.imageset/realtime_prompt_submit.png`：自由模式提交箭头。

JSON SHA-256：`979b8c3bc9269ad2a5199c416f682bf9cebb2c88b59b56c929f7dd2c594444f1`。

缩略图由 RN Image 加载与 iOS 相同的 iconURL，没有替换成占位演示数据。构建不读取同级 iOS 工程。自选图片现已接入普通 COS 上传，成功后记录 referencePath；预设不重复上传。参考图驱动生成仍未接入，本轮仅扩展上传及其 loading/重试状态。

2026-09-10：顶部按钮复用同一 iOS Assets.xcassets 的 `realtime_nav_back.imageset/realtime_nav_back.png` → `realtime_nav_back@3x.png`（原件 96 × 96，逻辑尺寸 32 × 32），以及 `realtime_camera_rotate.imageset/realtime_camera_rotate.png` → `realtime_camera_rotate.png`（原件 80 × 80，沿用 1× 声明，界面显示为 22 × 22）。原始图形未修改。

2026-09-10：`RealtimeLoading.dataset/RealtimeLoading.gif` 原样复制为 `RealtimeLoading.gif`，用于 RealtimeLoadingOverlay 中央 54 × 50 动画。SHA-256：`7a89479c766883d2b0d2f3181d4bcc85e45e04ac27e16c5543d92e48d547d01c`。Android XLab 增加与 RN 0.87.1 相同版本的 Fresco animated-gif 3.7.0 解码支持；不向 SDK 消费者增加依赖。

中英文添加参考图按钮分别原样复制 `realtime_add_reference.imageset` 和 `realtime_add_reference_en.imageset`，跟随 XLab 解析后的界面语言选择，与 iOS 一致。

Toolbar icons `realtime_statistics`, `realtime_volume`, `realtime_photos`, `realtime_sound`, and `realtime_muted` are raster exports of the system symbols `chart.bar.fill`, `slider.horizontal.3`, `photo`, `speaker.wave.2.fill`, and `speaker.slash.fill` used by the UIKit reference, supplied at 1×, 2×, and 3×.

Recording toolbar icons `realtime_record`, `realtime_record_stop`, and `realtime_record_busy` are 1×, 2×, and 3× raster exports of the system symbols `record.circle`, `stop.circle.fill`, and `hourglass` used by the UIKit reference.
