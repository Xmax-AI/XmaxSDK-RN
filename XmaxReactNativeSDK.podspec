require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))
Pod::Spec.new do |s|
  s.name = 'XmaxReactNativeSDK'
  s.version = package['version']
  s.summary = package['description']
  s.homepage = 'https://xmax.cloud'
  s.license = { :type => 'MIT', :file => 'LICENSE' }
  s.author = 'Xmax'
  s.source = { :path => '.' }
  s.platforms = { :ios => '15.1' }
  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.private_header_files = 'ios/XmaxRuntime.h'
  s.swift_version = '6.0'
  s.dependency 'AgoraRtcEngine_iOS/RtcBasic', '4.6.4'
  s.frameworks = 'AVFoundation', 'UIKit', 'ImageIO', 'CoreVideo', 'CoreMedia'
  install_modules_dependencies(s)
end
