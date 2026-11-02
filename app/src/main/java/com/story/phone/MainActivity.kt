package com.story.phone

import android.Manifest
import android.annotation.SuppressLint
import android.content.BroadcastReceiver
import android.content.Context
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Resources
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.webkit.GeolocationPermissions
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.story.phone.R

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var androidMcp: AndroidMcp
    private var fileUploadCallback: ValueCallback<Array<Uri>>? = null
    private val FILE_CHOOSER_RESULT_CODE = 101
    private val PERMISSIONS_REQUEST_CODE = 102

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webview)
        
        webView.webViewClient = object : WebViewClient() {
            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                return false 
            }

            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: android.webkit.WebResourceRequest?
            ): Boolean {
                return false 
            }
        }

        // 重写 WebChromeClient 解决定位授权与网页 File 文件选择器失灵问题
        webView.webChromeClient = object : WebChromeClient() {
            // 支持 HTML5 Geolocation 定位授权
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }

            // 支持 HTML5 <input type="file"> 文件选择器
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                @Suppress("UNCHECKED_CAST")
                (fileUploadCallback as? ValueCallback<Array<Uri>?>)?.onReceiveValue(null)
                fileUploadCallback = filePathCallback

                // 【修复点】：如果 createIntent 返回 null，直接 return false，彻底解决报错！
                val intent = fileChooserParams?.createIntent() ?: return false
                
                try {
                    startActivityForResult(intent, FILE_CHOOSER_RESULT_CODE)
                } catch (e: ActivityNotFoundException) {
                    fileUploadCallback = null
                    return false
                }
                return true
            }
        }

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true 
        settings.allowFileAccess = true   
        settings.allowContentAccess = true
        settings.databaseEnabled = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        
        // 解锁 AI 在后台静默自动点播放歌
        settings.mediaPlaybackRequiresUserGesture = false

        // 注入 window.AndroidMCP 原生接口并向静态通道注册主 Activity 引用
        AndroidMcp.mainActivity = this
        androidMcp = AndroidMcp.getInstance(this)
        webView.addJavascriptInterface(androidMcp, "AndroidMCP")

        // 加载 assets 本地打包的前端页面
        webView.loadUrl("file:///android_asset/index.html")

        // 自动申请 Android 定位与通知的系统级运行时权限
        requestAppPermissions()
    }

    // 处理文件选择器弹窗的回调 
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_CHOOSER_RESULT_CODE) {
            if (fileUploadCallback == null) return
            val results = WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            
            @Suppress("UNCHECKED_CAST")
            (fileUploadCallback as? ValueCallback<Array<Uri>?>)?.onReceiveValue(results)
            fileUploadCallback = null
        }
    }

    // 申请运行时权限
    private fun requestAppPermissions() {
        val permissions = mutableListOf(
            // GPS 定位（网页“定位卡片/天气”需要）；Android 12+ 蓝牙扫描不依赖它(SCAN带neverForLocation)
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        // 动态合并追加存储与媒体音频权限，兼容 Android 13+ 与旧版系统
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            permissions.add(Manifest.permission.READ_MEDIA_AUDIO)
        } else {
            @Suppress("DEPRECATION")
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
            @Suppress("DEPRECATION")
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
        }
        // 蓝牙管理：Android 12+ 读取/连接蓝牙设备所需运行时权限
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
            permissions.add(Manifest.permission.BLUETOOTH_SCAN)
        }

        val listToRequest = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (listToRequest.isNotEmpty()) {
            ActivityCompat.requestPermissions(
                this,
                listToRequest.toTypedArray(),
                PERMISSIONS_REQUEST_CODE
            )
        }
    }

    // 蓝牙等运行时权限结果回执：转发给 AndroidMcp 记录（JS 权限引导用）
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        try {
            if (permissions.any { it == Manifest.permission.BLUETOOTH_CONNECT || it == Manifest.permission.BLUETOOTH_SCAN }) {
                AndroidMcp.recordBluetoothPermissionResult(permissions, grantResults)
            }
        } catch (e: Exception) { e.printStackTrace() }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack() // 返回键优先控制 WebView 回退
        } else {
            super.onBackPressed()
        }
    }
}

/**
 * 前台服务 —— 保障后台运行时不被系统杀进程，
 * 同时支持歌单持续播放与后台发信功能。
 *
 * ⚠ 使用前必须满足：
 * 1) AndroidManifest.xml 中声明了 <service android:foregroundServiceType="specialUse" />
 * 2) Android 13+ 已获取 POST_NOTIFICATIONS 权限
 * 3) 调用 context.startForegroundService(intent) 后，本服务必须在 5 秒内
 *    调用 startForeground()，否则系统抛出 ForegroundServiceDidNotStartInTimeException
 */
class McpForegroundService : Service() {

    companion object {
        private const val TAG = "McpForegroundService"
        private const val CHANNEL_ID = "mcp_foreground_service_channel"
        private const val NOTIFICATION_ID = 1005
    }

    // 静默音频保活：播放无声音频保持 WebView JS 环境活跃，防止后台被冻结
    private var keepAliveAudioTrack: android.media.AudioTrack? = null

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()

        val notification = buildNotification()
        startForeground(NOTIFICATION_ID, notification)

        // 启动静默音频保活，保持 WebView JS 环境活跃
        startKeepAliveAudio()

        // ★ 启动 Headless 后台中枢：即使 Activity 被销毁，JS 中枢（主动发信/闹钟/桌宠）依然存活
        startHeadlessCenter()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        // 停止静默音频保活
        stopKeepAliveAudio()
        // 销毁后台中枢 WebView，释放渲染进程
        try {
            AndroidMcp.centerWebView?.stopLoading()
            AndroidMcp.centerWebView?.destroy()
        } catch (e: Exception) { e.printStackTrace() }
        AndroidMcp.centerWebView = null
        // 兜底释放 AndroidMcp 持有的后台 WakeLock，防止服务被回收后 WakeLock 仍占用
        try {
            AndroidMcp.releaseWakeLockIfHeld()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        // 释放蓝牙 SPP/GATT 连接资源
        try {
            AndroidMcp.releaseBluetoothIfHeld()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        super.onDestroy()
    }

    /**
     * Headless 后台中枢：创建一个不挂接任何窗口的隐藏 WebView，加载完整 index.html。
     * Activity 销毁后 JS 引擎随 Activity 的 WebView 一起消亡，但此中枢 WebView 由前台服务托管，
     * 只要服务存活（常驻保活通知在），JS 中枢就持续运行。
     * 注入目标策略：AndroidMcp.getEffectiveWebView() 优先返回本中枢，其次才兜底 Activity 的 WebView。
     */
    private fun startHeadlessCenter() {
        try {
            if (AndroidMcp.centerWebView != null) return
            val webView = WebView(this)
            val settings = webView.settings
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.allowFileAccess = true
            settings.allowContentAccess = true
            settings.databaseEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            settings.mediaPlaybackRequiresUserGesture = false

            val mcp = AndroidMcp.getInstance(applicationContext)
            webView.addJavascriptInterface(mcp, "AndroidMCP")
            webView.webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView?, url: String?) {
                    super.onPageFinished(view, url)
                    try {
                        // 页面加载完成后注入中枢初始化（恢复会话/闹钟状态等）
                        view?.evaluateJavascript(
                            "javascript:if(window.initBackgroundCenter){window.initBackgroundCenter();}",
                            null
                        )
                        android.util.Log.d(TAG, "后台中枢 JS 初始化注入完成")
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }
            }

            // 关键：不 addView 到任何窗口 —— Headless 模式只执行 JS，不渲染 UI
            webView.loadUrl("file:///android_asset/index.html")
            AndroidMcp.centerWebView = webView
            android.util.Log.d(TAG, "Headless 后台中枢 WebView 已启动")
        } catch (e: Exception) {
            android.util.Log.e(TAG, "启动后台中枢 WebView 失败: ${e.message}")
            e.printStackTrace()
        }
    }

    /**
     * 静默音频保活：使用 AudioTrack 播放无声音频，让系统认为应用正在播放媒体，
     * 从而保持 WebView 的 JS 执行环境活跃，防止后台时 evaluateJavascript 和 fetch 被冻结。
     * 这解决了"必须留在 APK 内才能触发发信"的核心问题。
     */
    private fun startKeepAliveAudio() {
        try {
            val sampleRate = 8000  // 低采样率省电
            val frames = sampleRate  // 1秒的帧数
            val bufferSizeInBytes = frames * 2  // 16bit mono = 2 bytes/frame

            val audioTrack = android.media.AudioTrack.Builder()
                .setAudioAttributes(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                .setAudioFormat(
                    android.media.AudioFormat.Builder()
                        .setEncoding(android.media.AudioFormat.ENCODING_PCM_16BIT)
                        .setSampleRate(sampleRate)
                        .setChannelMask(android.media.AudioFormat.CHANNEL_OUT_MONO)
                        .build()
                )
                .setBufferSizeInBytes(bufferSizeInBytes)
                .setTransferMode(android.media.AudioTrack.MODE_STATIC)
                .build()

            // 写入静音 PCM 数据（全零）
            val silentData = ByteArray(bufferSizeInBytes)
            audioTrack.write(silentData, 0, silentData.size)

            // 设置无限循环播放
            audioTrack.setLoopPoints(0, frames, -1)

            audioTrack.play()
            keepAliveAudioTrack = audioTrack

            android.util.Log.d("McpForegroundService", "静默音频保活已启动")
        } catch (e: Exception) {
            android.util.Log.e("McpForegroundService", "静默音频保活启动失败: ${e.message}")
            e.printStackTrace()
        }
    }

    private fun stopKeepAliveAudio() {
        try {
            keepAliveAudioTrack?.stop()
            keepAliveAudioTrack?.release()
            keepAliveAudioTrack = null
            android.util.Log.d("McpForegroundService", "静默音频保活已停止")
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // ---------------------------------------------------------------
    // 通知构建
    // ---------------------------------------------------------------

    /**
     * 构建前台通知：
     * - 优先使用项目自有图标 R.drawable.ic_launcher
     * - 若资源加载失败（例如资源 ID 无效或资源未找到），
     *   降级为 Android 系统内置图标 android.R.drawable.ic_dialog_info
     */
    private fun buildNotification(): android.app.Notification {
        val notificationIntent = Intent(this, MainActivity::class.java)

        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            notificationIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
        )

        // 安全加载小图标 —— 避免因资源找不到导致前台服务启动失败
        val smallIcon = safeGetSmallIcon()

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("叙事诗前台守护中")
            .setContentText("系统不休眠、歌单播放与后台发信功能保护中")
            .setSmallIcon(smallIcon)
            .setContentIntent(pendingIntent)
            .build()
    }

    /**
     * 安全获取通知小图标：
     * 尝试使用 R.drawable.ic_launcher，若抛出异常则降级为系统图标
     */
    private fun safeGetSmallIcon(): Int {
        return try {
            // 验证资源是否存在
            resources.getDrawable(R.drawable.ic_launcher, theme)
            R.drawable.ic_launcher
        } catch (e: Resources.NotFoundException) {
            // 资源未找到时使用系统原生图标兜底
            android.R.drawable.ic_dialog_info
        } catch (e: Exception) {
            android.R.drawable.ic_dialog_info
        }
    }

    // ---------------------------------------------------------------
    // 通知渠道
    // ---------------------------------------------------------------

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val serviceChannel = NotificationChannel(
                CHANNEL_ID,
                "叙事诗后台守护通道",
                NotificationManager.IMPORTANCE_LOW
            )
            val manager = getSystemService(NotificationManager::class.java)
            manager?.createNotificationChannel(serviceChannel)
        }
    }
}

// ============================================================
//  后台保活 / 定时闹钟 / 开机自启 三个 BroadcastReceiver
// ============================================================

/**
 * 后台心跳 Receiver：由 AlarmManager.setAndAllowWhileIdle 触发，
 * Doze 下仍可唤醒 CPU。收到后链式重排下一次，并向 WebView 注入心跳 JS。
 */
class BgPollReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        val intervalMs = intent?.getLongExtra(EXTRA_INTERVAL_MS, DEFAULT_INTERVAL_MS) ?: DEFAULT_INTERVAL_MS
        // 链式重排下一次唤醒
        scheduleNextPoll(context, intervalMs)
        // 向中枢 WebView 注入心跳 JS（Service Headless 优先，Activity 兜底）
        // Activity 销毁后，Headless 中枢仍在，心跳照常驱动 JS 发信
        val webView = AndroidMcp.getEffectiveWebView() ?: return
        webView.post {
            try {
                webView.evaluateJavascript(
                    "javascript:if(window.desktopPetSystem && typeof window.desktopPetSystem.triggerBackgroundActiveMessageNative === 'function') { window.desktopPetSystem.triggerBackgroundActiveMessageNative(); }",
                    null
                )
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    companion object {
        private const val EXTRA_INTERVAL_MS = "interval_ms"
        private const val DEFAULT_INTERVAL_MS = 10L * 60_000L
        private const val REQUEST_CODE = 9991

        fun scheduleNextPoll(context: Context, intervalMs: Long) {
            try {
                val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                val intent = Intent(context, BgPollReceiver::class.java).apply {
                    action = "com.story.phone.ACTION_BG_POLL"
                    putExtra(EXTRA_INTERVAL_MS, intervalMs)
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                } else {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pi = android.app.PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
                val triggerAt = System.currentTimeMillis() + intervalMs
                // setAndAllowWhileIdle 在 Doze 下仍能唤醒，且不需要 SCHEDULE_EXACT_ALARM 权限
                am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAt, pi)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }

        fun cancelPoll(context: Context) {
            try {
                val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                val intent = Intent(context, BgPollReceiver::class.java).apply {
                    action = "com.story.phone.ACTION_BG_POLL"
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                } else {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pi = android.app.PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
                am.cancel(pi)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}

/**
 * 应用内定时闹钟 Receiver：到点后发系统通知 + 振动 + 唤醒 WebView 发消息。
 * 由 AndroidMcp.setInAppAlarm 通过 AlarmManager 调度。
 */
class InAppAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        // 停止响铃指令（通知上的"停止响铃"按钮触发）
        if (intent?.action == ACTION_STOP_RINGTONE) {
            stopRingtone()
            try {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                nm.cancel(1007)
            } catch (e: Exception) { e.printStackTrace() }
            return
        }
        val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: "叙事诗闹钟提醒"
        // 0. ★ Kotlin 原生播放本地闹钟铃声（MediaPlayer 循环播放直到关闭，不依赖 JS 环境）
        playAlarmRingtoneNative(context, message)
        // 1. 三连振动（闹钟提醒强度）
        try {
            val pattern = longArrayOf(0, 500, 200, 500, 200, 900)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager
                vm.defaultVibrator.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                val v = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
                v.vibrate(android.os.VibrationEffect.createWaveform(pattern, -1))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        // 2. 发系统通知
        try {
            showAlarmNotification(context, message)
        } catch (e: Exception) {
            e.printStackTrace()
        }
        // 3. 直接通过 evaluateJavascript 触发 AI 发信
        //    注入中枢 WebView（Service Headless 优先，Activity 兜底），Activity 销毁后仍可执行
        val webView = AndroidMcp.getEffectiveWebView()
        if (webView != null) {
            webView.post {
                try {
                    val quoted = org.json.JSONObject.quote(message)
                    webView.evaluateJavascript(
                        "javascript:if(window.desktopPetSystem && typeof window.desktopPetSystem.handleInAppAlarm === 'function') { window.desktopPetSystem.handleInAppAlarm($quoted); }",
                        null
                    )
                } catch (ex: Exception) {
                    ex.printStackTrace()
                }
            }
        }
    }

    /**
     * Kotlin 原生播放闹钟铃声：解析 message JSON 中的 ringtone 字段，
     * 匹配 /Music/Storypoem 目录下的本地歌曲用 MediaPlayer 循环播放 20 秒。
     * 完全不依赖 WebView JS 环境，退出应用后依然能响铃。
     * 支持 "local:N" / 纯数字索引 / 歌曲标题模糊匹配。
     */
    private fun playAlarmRingtoneNative(context: Context, message: String) {
        try {
            var ringtone: Any? = null
            try {
                val obj = org.json.JSONObject(message)
                if (obj.has("ringtone") && !obj.isNull("ringtone")) ringtone = obj.get("ringtone")
            } catch (e: Exception) { return }
            if (ringtone == null) return
            val raw = ringtone.toString().trim()
            if (raw.isEmpty() || raw == "default") return

            val musicFiles = listMusicFiles(context)
            var targetName: String? = null
            if (raw.contains(":")) {
                // "local:3" 本地歌曲索引（library 在线歌曲无法原生播放，忽略）
                val parts = raw.split(":")
                if (parts.size == 2 && parts[0] == "local") {
                    val idx = parts[1].toIntOrNull() ?: return
                    if (idx in musicFiles.indices) targetName = musicFiles[idx]
                }
            } else if (raw.matches(Regex("\\d+"))) {
                val idx = raw.toInt()
                if (idx in musicFiles.indices) targetName = musicFiles[idx]
            } else {
                targetName = musicFiles.firstOrNull { it.contains(raw, ignoreCase = true) }
            }
            if (targetName == null) return

            val musicDir = getAlarmMusicDir(context)
            val file = java.io.File(musicDir, targetName)
            if (!file.exists()) return

            // ★ 循环播放直到用户手动关闭（通知按钮 / MCP 面板"停止响铃"）
            stopRingtone()
            val player = android.media.MediaPlayer()
            player.setDataSource(file.absolutePath)
            player.isLooping = true
            player.setVolume(1f, 1f)
            player.prepare()
            player.start()
            ringtonePlayer = player
            android.util.Log.d("InAppAlarmReceiver", "闹钟铃声循环播放中: $targetName")
        } catch (e: Exception) {
            android.util.Log.e("InAppAlarmReceiver", "播放闹钟铃声失败: ${e.message}")
        }
    }

    private fun listMusicFiles(context: Context): List<String> {
        return getAlarmMusicDir(context).listFiles { _, name ->
            name.endsWith(".mp3", true) || name.endsWith(".wav", true) || name.endsWith(".m4a", true)
        }?.map { it.name } ?: emptyList()
    }

    private fun getAlarmMusicDir(context: Context): java.io.File {
        @Suppress("DEPRECATION")
        val dir = java.io.File(
            android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_MUSIC),
            "Storypoem"
        )
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun showAlarmNotification(context: Context, message: String) {
        // 使用 _v2 后缀的新 channel ID，强制重建 importance
        val channelId = "story_phone_alarm_channel_v2"
        val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            var channel = nm.getNotificationChannel(channelId)
            if (channel == null) {
                nm.deleteNotificationChannel("story_phone_alarm_channel")
                channel = android.app.NotificationChannel(channelId, "叙事诗闹钟提醒", android.app.NotificationManager.IMPORTANCE_HIGH).apply {
                    description = "应用内定时闹钟到点提醒（Heads-up 弹出式）"
                    enableVibration(true)
                    enableLights(true)
                    lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                }
                nm.createNotificationChannel(channel)
            }
        }
        val notifyIntent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
        } else {
            android.app.PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pi = android.app.PendingIntent.getActivity(context, 0, notifyIntent, flags)
        val smallIcon = try {
            context.resources.getDrawable(R.drawable.ic_launcher, context.theme)
            R.drawable.ic_launcher
        } catch (e: Exception) {
            android.R.drawable.ic_dialog_info
        }
        val notification = androidx.core.app.NotificationCompat.Builder(context, channelId)
            .setSmallIcon(smallIcon)
            .setContentTitle("叙事诗闹钟")
            .setContentText(message)
            .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
            .setCategory(androidx.core.app.NotificationCompat.CATEGORY_ALARM)
            .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
            .setVibrate(longArrayOf(0, 500, 300, 500))
            .setDefaults(androidx.core.app.NotificationCompat.DEFAULT_SOUND)
            .setAutoCancel(true)
            .setContentIntent(pi)
            // "停止响铃"按钮：直接广播给本 Receiver，停止循环铃声并关闭通知
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "停止响铃",
                PendingIntent.getBroadcast(
                    context,
                    9993,
                    Intent(context, InAppAlarmReceiver::class.java).apply {
                        action = ACTION_STOP_RINGTONE
                    },
                    flags
                )
            )
            .build()
        nm.notify(1007, notification)
    }

    companion object {
        private const val EXTRA_MESSAGE = "alarm_message"
        private const val REQUEST_CODE = 9992
        const val ACTION_STOP_RINGTONE = "com.story.phone.ACTION_STOP_RINGTONE"

        /** 当前循环播放中的闹钟铃声 MediaPlayer（进程级静态持有，供全局停止） */
        @Volatile private var ringtonePlayer: android.media.MediaPlayer? = null

        /** 停止闹钟铃声（通知按钮 / MCP 面板 / 取消闹钟时调用） */
        @JvmStatic
        fun stopRingtone() {
            try {
                ringtonePlayer?.stop()
                ringtonePlayer?.release()
            } catch (e: Exception) { e.printStackTrace() }
            ringtonePlayer = null
        }

        /** 当前是否有闹钟铃声在响 */
        @JvmStatic
        fun isRingtonePlaying(): Boolean = ringtonePlayer?.isPlaying == true

        // 取消应用内闹钟：用相同 REQUEST_CODE 重建 PendingIntent 并 cancel
        fun cancel(context: Context): Boolean {
            return try {
                val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                val intent = Intent(context, InAppAlarmReceiver::class.java).apply {
                    action = "com.story.phone.ACTION_IN_APP_ALARM"
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                } else {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pi = android.app.PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
                am.cancel(pi)
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }

        fun schedule(context: Context, triggerAtMillis: Long, message: String): Boolean {
            return try {
                val am = context.getSystemService(Context.ALARM_SERVICE) as android.app.AlarmManager
                val intent = Intent(context, InAppAlarmReceiver::class.java).apply {
                    action = "com.story.phone.ACTION_IN_APP_ALARM"
                    putExtra(EXTRA_MESSAGE, message)
                }
                val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                } else {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                }
                val pi = android.app.PendingIntent.getBroadcast(context, REQUEST_CODE, intent, flags)
                // ★ 首选 setAlarmClock：闹钟标准 API，无需 SCHEDULE_EXACT_ALARM 权限，
                //   系统保证精确触发（锁屏/Doze 下同样准时），并在状态栏显示闹钟图标
                try {
                    val alarmInfo = android.app.AlarmManager.AlarmClockInfo(triggerAtMillis, null)
                    am.setAlarmClock(alarmInfo, pi)
                } catch (e1: Exception) {
                    e1.printStackTrace()
                    // 降级 1：精确闹钟（需 SCHEDULE_EXACT_ALARM 权限）
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        if (am.canScheduleExactAlarms()) {
                            am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
                        } else {
                            am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
                        }
                    } else {
                        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
                    }
                }
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            }
        }
    }
}

/**
 * 开机自启 Receiver：开机后重启前台守护服务，恢复保活。
 * 需要 RECEIVE_BOOT_COMPLETED 权限（已在 AndroidManifest 声明）。
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent?) {
        try {
            val serviceIntent = Intent(context, McpForegroundService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent)
            } else {
                context.startService(serviceIntent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
}