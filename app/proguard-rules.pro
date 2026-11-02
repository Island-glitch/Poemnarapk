-keepattributes *Annotation*
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keep class com.story.phone.AndroidMcp { *; }

# 正在播放监听服务（Manifest 声明的 NotificationListenerService，防混淆/裁剪）
-keep class com.story.phone.NowPlayingListenerService { *; }

# 蓝牙 MCP 桥接类（Manifest 权限与 WebView 桥接均依赖，防混淆/裁剪）
-keep class com.story.phone.BluetoothMcp { *; }