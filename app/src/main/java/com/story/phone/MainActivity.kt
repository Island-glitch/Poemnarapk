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
        androidMcp = AndroidMcp(this)
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

    override fun onBackPressed() {
        if (webView.canGoBack()) {
            webView.goBack() // 返回键优先控制 WebView 回退
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        try {
            // 停止 AlarmManager 后台心跳，并注销媒体控制 Receiver，避免内存泄漏
            androidMcp.stopBackgroundPolling()
            androidMcp.unregisterMediaReceiver()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        super.onDestroy()
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
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        // 停止静默音频保活
        stopKeepAliveAudio()
        // 兜底释放 AndroidMcp 持有的后台 WakeLock，防止服务被回收后 WakeLock 仍占用
        try {
            AndroidMcp.releaseWakeLockIfHeld()
        } catch (e: Exception) {
            e.printStackTrace()
        }
        super.onDestroy()
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
        // 强制在 UI 线程向 WebView 注入心跳 JS
        val activity = AndroidMcp.mainActivity ?: return
        activity.runOnUiThread {
            try {
                val webView = activity.findViewById<WebView>(R.id.webview)
                webView?.evaluateJavascript(
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
        val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: "叙事诗闹钟提醒"
        // 1. 振动
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as android.os.VibratorManager
                vm.defaultVibrator.vibrate(android.os.VibrationEffect.createOneShot(1000L, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val v = context.getSystemService(Context.VIBRATOR_SERVICE) as android.os.Vibrator
                v.vibrate(android.os.VibrationEffect.createOneShot(1000L, android.os.VibrationEffect.DEFAULT_AMPLITUDE))
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
        //    配合 McpForegroundService 的静默音频保活，WebView JS 环境在后台保持活跃
        val activity = AndroidMcp.mainActivity
        if (activity != null) {
            activity.runOnUiThread {
                try {
                    val webView = activity.findViewById<WebView>(R.id.webview)
                    val quoted = org.json.JSONObject.quote(message)
                    webView?.evaluateJavascript(
                        "javascript:if(window.desktopPetSystem && typeof window.desktopPetSystem.handleInAppAlarm === 'function') { window.desktopPetSystem.handleInAppAlarm($quoted); }",
                        null
                    )
                } catch (ex: Exception) {
                    ex.printStackTrace()
                }
            }
        }
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
            .build()
        nm.notify(1007, notification)
    }

    companion object {
        private const val EXTRA_MESSAGE = "alarm_message"
        private const val REQUEST_CODE = 9992

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
                // 优先精确闹钟（需 SCHEDULE_EXACT_ALARM），无权限则降级 setAndAllowWhileIdle
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    if (am.canScheduleExactAlarms()) {
                        am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
                    } else {
                        am.setAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
                    }
                } else {
                    am.setExactAndAllowWhileIdle(android.app.AlarmManager.RTC_WAKEUP, triggerAtMillis, pi)
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
