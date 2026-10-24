//
//  XmaxTrajectoryView.swift
//  XmaxSDK
//
//  Author: 翁跃庭 (Yueting Weng)
//  GitHub: https://github.com/Xmax-AI/XmaxSDK-RN
//
//  Copyright (c) 2026 XMAX.AI PTE. LTD.
//

import UIKit

/// A view-owned native trajectory canvas that draws trails and fingertip animations in logical
/// viewport coordinates.
@MainActor
@objc(XmaxTrajectoryView)
public final class XmaxTrajectoryView: UIView {

  /// The current touch position, colors, and monotonic contact start time.
  private struct Finger {

    /// The latest touch position within the viewport, in logical layout units.
    var point: CGPoint

    /// The trajectory center and highlighted trail color.
    let core: UIColor

    /// The trajectory glow and outer trail color.
    let glow: UIColor

    /// The monotonic contact start time, in seconds.
    let began: CFTimeInterval
  }

  /// A weak display callback proxy that avoids retaining a removed canvas.
  @MainActor
  private final class TickTarget: NSObject {

    /// The weak view reference receiving display or RTC rendering callbacks.
    weak var view: XmaxTrajectoryView?

    /// Advances trail fading and redraws active touches using monotonic animation time.
    ///
    /// - Parameter link: The display link providing monotonic timestamps for animation.
    @objc
    func tick(
      _ link: CADisplayLink
    ) {
      view?.tick(link.timestamp)
    }
  }

  /// The active touch identifiers and their latest positions, colors, and animation times.
  private var fingers: [String: Finger] = [:]

  /// The offscreen trail bitmap, released or rebuilt when view resources or dimensions change.
  private var bitmap: CGContext?

  /// The trail bitmap's logical viewport dimensions.
  private var bitmapSize: CGSize = .zero

  /// The number of pixels per logical unit in the trail bitmap.
  private var bitmapScale: CGFloat = 0

  /// The monotonic time of the latest animation update, in seconds.
  private var lastTick: CFTimeInterval = 0

  /// The monotonic time of the latest trail segment, in seconds.
  private var lastMove: CFTimeInterval = 0

  /// Whether the bitmap contains a trail that still needs to fade.
  private var hasTrail = false

  /// The display-synchronized animation timer, stopped when the canvas has no effects or is
  /// removed.
  private var displayLink: CADisplayLink?

  /// The display callback proxy that avoids strongly retaining the trajectory view.
  private let tickTarget = TickTarget()

  /// Applies a trajectory drawing command inside a validated container.
  ///
  /// - Parameters:
  ///   - host: The validated React Native container hosting a trajectory or RTC canvas.
  ///   - command: The serialized trajectory drawing command.
  @objc(renderIn:command:)
  public static func render(
    in host: UIView,
    command: String
  ) {
    guard let data = command.data(using: .utf8),
      let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let action = value["action"] as? String
    else { return }

    let existing = host.subviews.compactMap { $0 as? XmaxTrajectoryView }.first
    if action == "detach" {
      existing?.reset()
      existing?.removeFromSuperview()
      return
    }
    let canvas = existing ?? XmaxTrajectoryView(frame: host.bounds)
    if existing == nil {
      canvas.autoresizingMask = [.flexibleWidth, .flexibleHeight]
      host.addSubview(canvas)
    }
    canvas.apply(
      action,
      value: value
    )
  }

  /// Creates a trajectory canvas and registers background cleanup notifications.
  ///
  /// - Parameter frame: The initial view bounds, in logical layout units.
  public override init(
    frame: CGRect
  ) {
    super.init(
      frame: frame
    )
    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    tickTarget.view = self
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(reset),
      name: UIApplication.didEnterBackgroundNotification,
      object: nil
    )
  }

  /// Rejects archive initialization; this canvas must be created programmatically.
  ///
  /// - Parameter coder: The archive decoder; archive initialization is unsupported for this view.
  @available(
    *,
    unavailable
  )
  public required init?(
    coder: NSCoder
  ) { fatalError("init(coder:) is unavailable") }

  /// Removes display callbacks and notification observers when the canvas is released.
  isolated deinit {
    displayLink?.invalidate()
    NotificationCenter.default.removeObserver(self)
  }

  /// Stops and clears animations when the canvas leaves its window.
  public override func didMoveToWindow() {
    super.didMoveToWindow()
    if window == nil { reset() }
  }

  /// Updates bitmap dimensions when the canvas bounds or display scale changes.
  public override func layoutSubviews() {
    super.layoutSubviews()
    prepareBitmap()
  }

  /// Executes a validated begin, move, end, reset, or detach drawing command.
  ///
  /// - Parameters:
  ///   - action: The work performed under this operation's cancellation and ownership lease.
  ///   - value: The decoded drawing action and validated touch data.
  private func apply(
    _ action: String,
    value: [String: Any]
  ) {
    if action == "reset" {
      reset()
      return
    }
    if action == "end" {
      for id in value["ids"] as? [String] ?? [] { fingers.removeValue(forKey: id) }
    } else if action == "begin" || action == "move" {
      for item in value["points"] as? [[String: Any]] ?? [] {
        guard let id = item["id"] as? String,
          let x = item["x"] as? Double, let y = item["y"] as? Double,
          x.isFinite, y.isFinite
        else { continue }
        let point = CGPoint(
          x: x,
          y: y
        )
        if var finger = fingers[id], action == "move" {
          drawSegment(
            from: finger.point,
            to: point,
            finger: finger
          )
          finger.point = point
          fingers[id] = finger
        } else if action == "begin" {
          fingers[id] = Finger(
            point: point,
            core: Self.color(
              item["core"],
              fallback: .white
            ),
            glow: Self.color(
              item["glow"],
              fallback: .green
            ),
            began: CACurrentMediaTime()
          )
        }
      }
    }
    start()
    setNeedsDisplay()
  }

  /// Parses a trajectory color and uses the fallback when parsing fails.
  ///
  /// - Parameters:
  ///   - value: The CSS color text.
  ///   - fallback: The fallback value used when the color cannot be parsed.
  private static func color(
    _ value: Any?,
    fallback: UIColor
  ) -> UIColor {
    guard let text = value as? String, text.count == 7, text.first == "#",
      let hex = UInt32(
        text.dropFirst(),
        radix: 16
      )
    else { return fallback }
    return UIColor(
      red: CGFloat((hex >> 16) & 255) / 255,
      green: CGFloat((hex >> 8) & 255) / 255,
      blue: CGFloat(hex & 255) / 255,
      alpha: 1
    )
  }

  /// Clears touch points and trail pixels, then stops animation callbacks.
  @objc
  private func reset() {
    fingers.removeAll()
    bitmap?.clear(bounds)
    hasTrail = false
    displayLink?.invalidate()
    displayLink = nil
    lastTick = 0
    setNeedsDisplay()
  }

  /// Starts display-synchronized animation only while the visible canvas contains touch points or
  /// trails.
  private func start() {
    guard displayLink == nil, window != nil, !fingers.isEmpty || hasTrail else { return }
    let link = CADisplayLink(
      target: tickTarget,
      selector: #selector(TickTarget.tick(_:))
    )
    link.preferredFramesPerSecond = 60
    link.add(
      to: .main,
      forMode: .common
    )
    lastTick = CACurrentMediaTime()
    displayLink = link
  }

  /// Advances trail fading and redraws active touches using monotonic animation time.
  ///
  /// - Parameter now: The current monotonic animation time, in seconds.
  private func tick(
    _ now: CFTimeInterval
  ) {
    if hasTrail, let bitmap {
      bitmap.saveGState()
      bitmap.setBlendMode(.destinationOut)
      bitmap.setFillColor(
        UIColor.black.withAlphaComponent(
          1
            - pow(
              0.95,
              max(0, now - lastTick) * 60
            )
        ).cgColor
      )
      bitmap.fill(bounds)
      bitmap.restoreGState()
      if now - lastMove > 64.0 / 60 {
        bitmap.clear(bounds)
        hasTrail = false
      }
    }
    lastTick = now
    setNeedsDisplay()
    if fingers.isEmpty, !hasTrail {
      displayLink?.invalidate()
      displayLink = nil
    }
  }

  /// Creates or resizes the trail bitmap for the view bounds and display scale.
  private func prepareBitmap() {
    let scale = window?.screen.scale ?? traitCollection.displayScale
    guard bounds.width > 0, bounds.height > 0 else { return }
    guard bitmap == nil || bitmapSize != bounds.size || bitmapScale != scale else { return }
    bitmapSize = bounds.size
    bitmapScale = scale
    let width = Int(ceil(bounds.width * scale)), height = Int(ceil(bounds.height * scale))
    bitmap = CGContext(
      data: nil,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: width * 4,
      space: CGColorSpaceCreateDeviceRGB(),
      bitmapInfo: CGBitmapInfo.byteOrder32Big.rawValue | CGImageAlphaInfo.premultipliedLast.rawValue
    )
    bitmap?.translateBy(
      x: 0,
      y: CGFloat(height)
    )
    bitmap?.scaleBy(
      x: scale,
      y: -scale
    )
    hasTrail = false
  }

  /// Draws a trail segment using the current touch's center and glow colors.
  ///
  /// - Parameters:
  ///   - from: The previous touch position, in logical viewport coordinates.
  ///   - to: The new touch position, in logical viewport coordinates.
  ///   - finger: The touch colors and animation time used to draw the segment.
  private func drawSegment(
    from: CGPoint,
    to: CGPoint,
    finger: Finger
  ) {
    prepareBitmap()
    guard let context = bitmap else { return }
    context.saveGState()
    context.setBlendMode(.plusLighter)
    context.setLineCap(.round)
    for (width, alpha, blur): (CGFloat, CGFloat, CGFloat) in [
      (18, 0.22, 12), (10, 0.52, 6), (3, 0.82, 0),
    ] {
      let color = (width == 3 ? finger.core : finger.glow).withAlphaComponent(alpha)
      context.setStrokeColor(color.cgColor)
      context.setLineWidth(width)
      context.setShadow(
        offset: .zero,
        blur: blur,
        color: blur > 0 ? color.cgColor : nil
      )
      context.beginPath()
      context.move(to: from)
      context.addLine(to: to)
      context.strokePath()
    }
    context.restoreGState()
    hasTrail = true
    lastMove = CACurrentMediaTime()
  }

  /// Draws the trail bitmap and active touch effects in the view's logical coordinate space.
  ///
  /// - Parameter rect: The view rectangle to redraw, in logical layout units.
  public override func draw(
    _ rect: CGRect
  ) {
    if let image = bitmap?.makeImage() {
      UIImage(
        cgImage: image,
        scale: bitmapScale,
        orientation: .up
      ).draw(in: bounds)
    }
    guard let context = UIGraphicsGetCurrentContext() else { return }
    let now = CACurrentMediaTime()
    context.setBlendMode(.plusLighter)
    for finger in fingers.values {
      let elapsed = now - finger.began
      let pulse = (sin(elapsed * 1.2 * .pi * 2) + 1) / 2
      for index in 0..<2 {
        let phase = index == 0 ? pulse : 1 - pulse
        let radius = 14 + Double(index) * 18 + phase * 8
        context.setLineWidth(2)
        context.setStrokeColor(
          finger.glow.withAlphaComponent(0.5 * (1 - Double(index) * 0.2) * (0.5 + phase * 0.5))
            .cgColor
        )
        context.strokeEllipse(
          in: circle(
            finger.point,
            radius: radius
          )
        )
      }
      for index in 0..<4 {
        let direction: Double = index.isMultiple(of: 2) ? 1 : -1
        let angle = Double(index) / 4 * .pi * 2 + elapsed * 0.06 * direction
        let point = CGPoint(
          x: finger.point.x + cos(angle) * 22,
          y: finger.point.y + sin(angle) * 22
        )
        glow(
          context,
          at: point,
          radius: 6,
          color: finger.glow,
          alpha: 0.6 * (0.6 + sin(elapsed * 3 + Double(index)) * 0.4)
        )
      }
      // The center glow, rings, and trail endpoint share a center to keep the pulsing animation aligned.
      glow(
        context,
        at: finger.point,
        radius: 14 + pulse * 4,
        color: finger.glow,
        alpha: 0.65 + pulse * 0.25
      )
      context.setFillColor(finger.core.cgColor)
      context.fillEllipse(
        in: circle(
          finger.point,
          radius: 5
        )
      )
    }
  }

  /// Calculates the bounding rectangle for a center and radius.
  ///
  /// - Parameters:
  ///   - point: The shape center, in logical viewport coordinates.
  ///   - radius: The radius, in logical layout units.
  private func circle(
    _ point: CGPoint,
    radius: CGFloat
  ) -> CGRect {
    CGRect(
      x: point.x - radius,
      y: point.y - radius,
      width: radius * 2,
      height: radius * 2
    )
  }

  /// Draws a radial glow with the specified center, radius, color, and opacity.
  ///
  /// - Parameters:
  ///   - context: The native drawing context receiving the radial gradient.
  ///   - point: The shape center, in logical viewport coordinates.
  ///   - radius: The radius, in logical layout units.
  ///   - color: The native color used for this draw operation.
  ///   - alpha: The opacity, from 0 for transparent to 1 for opaque.
  private func glow(
    _ context: CGContext,
    at point: CGPoint,
    radius: CGFloat,
    color: UIColor,
    alpha: CGFloat
  ) {
    guard
      let gradient = CGGradient(
        colorsSpace: CGColorSpaceCreateDeviceRGB(),
        colors: [
          color.withAlphaComponent(alpha).cgColor, color.withAlphaComponent(alpha * 0.6).cgColor,
          color.withAlphaComponent(0).cgColor,
        ] as CFArray,
        locations: [0, 0.4, 1]
      )
    else { return }
    context.drawRadialGradient(
      gradient,
      startCenter: point,
      startRadius: 0,
      endCenter: point,
      endRadius: radius,
      options: []
    )
  }
}
