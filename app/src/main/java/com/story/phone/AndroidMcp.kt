package com.story.phone

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Environment
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.webkit.JavascriptInterface
import android.media.MediaPlayer
import android.util.Log
import java.io.File
import java.io.FileWriter
import org.json.JSONArray
import org.json.JSONObject
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.OnnxTensor
import java.nio.LongBuffer

class AndroidMcp(private val context: Context) {

    companion object {
        private const val TAG = "AndroidMcp"
        var mainActivity: MainActivity? = null
        @Volatile private var instance: AndroidMcp? = null

        /** 兜底释放后台 WakeLock，供 McpForegroundService.onDestroy 调用 */
        fun releaseWakeLockIfHeld() {
            try { instance?.releaseWakeLockSafe() } catch (e: Exception) { e.printStackTrace() }
        }
    }

    private var mediaPlayer: MediaPlayer? = null
    private var wakeLock: android.os.PowerManager.WakeLock? = null
    private var mediaSession: android.media.session.MediaSession? = null
    private var currentSongName: String = ""

    private val mediaControlReceiver = object : android.content.BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
            when (intent?.action) {
                "com.story.phone.ACTION_PLAY" -> {
                    resumeMusicNatively()
                }
                "com.story.phone.ACTION_PAUSE" -> {
                    pauseMusicNatively()
                }
                "com.story.phone.ACTION_STOP" -> {
                    stopMusicNatively()
                }
            }
        }
    }

    @JavascriptInterface
    fun toggleBackgroundWakeLock(enabled: Boolean) {
        Log.d(TAG, "toggleBackgroundWakeLock() called, enabled=$enabled")
        try {
            val serviceIntent = Intent(context, McpForegroundService::class.java)
            val powerManager = context.getSystemService(Context.POWER_SERVICE) as android.os.PowerManager
            if (enabled) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(serviceIntent)
                } else {
                    context.startService(serviceIntent)
                }
                if (wakeLock == null) {
                    wakeLock = powerManager.newWakeLock(android.os.PowerManager.PARTIAL_WAKE_LOCK, "StoryPhone::BackgroundWakeLock")
                }
                if (wakeLock?.isHeld == false) {
                    wakeLock?.acquire(30 * 60 * 1000L) // 30 分钟超时，避免永久持锁耗电
                }
            } else {
                context.stopService(serviceIntent)
                if (wakeLock?.isHeld == true) {
                    wakeLock?.release()
                }
                wakeLock = null
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun showSystemNotification(title: String, message: String) {
        Log.d(TAG, "showSystemNotification() called, title=$title, message=${message.take(50)}...")
        try {
            // 使用 _v2 后缀的新 channel ID，强制重建 importance（旧 channel 的 importance 一旦创建无法代码修改）
            val channelId = "story_phone_bg_channel_v2"
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                var channel = notificationManager.getNotificationChannel(channelId)
                if (channel == null) {
                    // 先删除旧 channel（如果存在），确保新 channel 的 importance 生效
                    notificationManager.deleteNotificationChannel("story_phone_bg_channel")
                    channel = android.app.NotificationChannel(channelId, "叙事诗消息通知", android.app.NotificationManager.IMPORTANCE_HIGH).apply {
                        description = "用于接收后台聊天消息通知（Heads-up 弹出式）"
                        enableVibration(true)
                        enableLights(true)
                        lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
                    }
                    notificationManager.createNotificationChannel(channel)
                }
            }

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context, 0, intent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE
                } else {
                    android.app.PendingIntent.FLAG_UPDATE_CURRENT
                }
            )

            val notification = androidx.core.app.NotificationCompat.Builder(context, channelId)
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle(title)
                .setContentText(message)
                .setStyle(androidx.core.app.NotificationCompat.BigTextStyle().bigText(message))
                .setPriority(androidx.core.app.NotificationCompat.PRIORITY_HIGH)
                .setCategory(androidx.core.app.NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(androidx.core.app.NotificationCompat.VISIBILITY_PUBLIC)
                .setVibrate(longArrayOf(0, 250, 200, 250))
                .setDefaults(androidx.core.app.NotificationCompat.DEFAULT_SOUND)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent)
                .build()

            notificationManager.notify(System.currentTimeMillis().toInt(), notification)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 初始化时自动创建本地物理存储文件夹：/Download/Storypoem 与 /Music/Storypoem
    init {
        instance = this
        try {
            getDownloadDir()
            getMusicDir()
            initMediaSession()
            registerMediaReceiver()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /** 释放后台 WakeLock（带异常保护），供 onDestroy / companion 兜底调用 */
    fun releaseWakeLockSafe() {
        try {
            if (wakeLock?.isHeld == true) {
                wakeLock?.release()
            }
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun getDownloadDir(): File {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Storypoem")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun getMusicDir(): File {
        val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC), "Storypoem")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    // 物理文件二进制追加流句柄，保障分批流式直写
    private var currentFileOutputStream: java.io.FileOutputStream? = null

    // 1.1 初始化真机物理分片写入流：开辟并锁定目标 ZIP 文件 (清空历史同名备份)
    @JavascriptInterface
    fun startBinaryChunkedSave(fileName: String): Boolean {
        Log.d(TAG, "startBinaryChunkedSave() called, fileName=$fileName")
        return try {
            currentFileOutputStream?.close()
            currentFileOutputStream = null

            val targetFile = File(getDownloadDir(), fileName)
            if (targetFile.exists()) {
                targetFile.delete()
            }
            // 启用 append = true 追加模式
            currentFileOutputStream = java.io.FileOutputStream(targetFile, true)
            true
        } catch (e: Exception) {
            Log.e(TAG, "startBinaryChunkedSave() failed: ${e.message}")
            e.printStackTrace()
            false
        }
    }

    // 1.2 物理追加数据分片：接收 500KB Base64 字符串，将其逆向解码为原始二进制字节流并直写磁盘 [2]
    @JavascriptInterface
    fun appendBinaryChunk(chunkBase64: String): Boolean {
        val outputStream = currentFileOutputStream ?: return false
        return try {
            val decodedBytes = android.util.Base64.decode(chunkBase64, android.util.Base64.DEFAULT)
            outputStream.write(decodedBytes)
            true
        } catch (e: Exception) {
            Log.e(TAG, "appendBinaryChunk() failed: ${e.message}")
            e.printStackTrace()
            false
        }
    }

    // 1.3 物理关闭分片写入流：刷盘固化数据，安全释放文件句柄
    @JavascriptInterface
    fun closeBinaryChunkedSave(): Boolean {
        Log.d(TAG, "closeBinaryChunkedSave() called")
        return try {
            currentFileOutputStream?.flush()
            currentFileOutputStream?.close()
            currentFileOutputStream = null
            true
        } catch (e: Exception) {
            Log.e(TAG, "closeBinaryChunkedSave() failed: ${e.message}")
            e.printStackTrace()
            false
        }
    }

    // 1.4 降级容灾直写：保留作为纯文本备份或单卡片调试导入直写
    @JavascriptInterface
    fun saveBackupFile(jsonString: String, fileName: String): Boolean {
        Log.d(TAG, "saveBackupFile() called, fileName=$fileName, data.length=${jsonString.length}")
        return try {
            val targetFile = File(getDownloadDir(), fileName)
            val writer = FileWriter(targetFile)
            writer.write(jsonString)
            writer.close()
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    // 1.5 原生 HTTP 网络请求接口：彻底击穿 WebView 浏览器 CORS 跨域与 Header 拦截限制
    @JavascriptInterface
    fun sendNativeHttpRequest(urlStr: String, method: String, headersJson: String, bodyStr: String): String {
        Log.d(TAG, "sendNativeHttpRequest() called, url=$urlStr, method=$method")
        return try {
            val url = java.net.URL(urlStr)
            val conn = url.openConnection() as java.net.HttpURLConnection
            conn.requestMethod = if (method.isEmpty()) "POST" else method.uppercase()
            conn.connectTimeout = 15000
            conn.readTimeout = 15000
            conn.instanceFollowRedirects = true

            if (headersJson.isNotEmpty()) {
                val jsonObj = JSONObject(headersJson)
                val keys = jsonObj.keys()
                while (keys.hasNext()) {
                    val key = keys.next()
                    conn.setRequestProperty(key, jsonObj.getString(key))
                }
            }

            if (bodyStr.isNotEmpty() && (conn.requestMethod == "POST" || conn.requestMethod == "PUT" || conn.requestMethod == "PATCH")) {
                conn.doOutput = true
                conn.outputStream.use { os ->
                    os.write(bodyStr.toByteArray(Charsets.UTF_8))
                }
            }

            val status = conn.responseCode
            val inputStream = if (status in 200..299) conn.inputStream else conn.errorStream
            val responseBody = inputStream?.bufferedReader()?.use { it.readText() } ?: ""

            val resHeaders = JSONObject()
            conn.headerFields?.forEach { (k, v) ->
                if (k != null && v.isNotEmpty()) {
                    if (k.equals("Set-Cookie", ignoreCase = true)) {
                        resHeaders.put("Set-Cookie", v.joinToString("; "))
                    } else {
                        resHeaders.put(k, v[0])
                    }
                }
            }

            val resultJson = JSONObject()
            resultJson.put("status", status)
            resultJson.put("body", responseBody)
            resultJson.put("headers", resHeaders)
            resultJson.toString()
        } catch (e: Exception) {
            Log.e(TAG, "sendNativeHttpRequest failed: ${e.message}", e)
            val errorJson = JSONObject()
            errorJson.put("status", 500)
            errorJson.put("body", e.message ?: "Native HTTP Error")
            errorJson.put("headers", JSONObject())
            errorJson.toString()
        }
    }

    // 2. 静默读取真机 /Music/Storypoem 目录下的本地歌单列表
    @JavascriptInterface
    fun scanLocalMusicFolder(): String {
        Log.d(TAG, "scanLocalMusicFolder() called")
        val jsonArray = JSONArray()
        try {
            val musicDir = getMusicDir()
            val files = musicDir.listFiles { _, name ->
                name.endsWith(".mp3", true) || name.endsWith(".wav", true) || name.endsWith(".m4a", true)
            }
            files?.forEach { file ->
                jsonArray.put(file.name)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return jsonArray.toString()
    }

    private fun registerMediaReceiver() {
        try {
            val filter = android.content.IntentFilter().apply {
                addAction("com.story.phone.ACTION_PLAY")
                addAction("com.story.phone.ACTION_PAUSE")
                addAction("com.story.phone.ACTION_STOP")
            }
            context.applicationContext.registerReceiver(mediaControlReceiver, filter)
        } catch (e: Exception) { e.printStackTrace() }
    }

    /** 注销媒体控制 BroadcastReceiver，避免内存泄漏；由 MainActivity.onDestroy 调用 */
    fun unregisterMediaReceiver() {
        try {
            context.applicationContext.unregisterReceiver(mediaControlReceiver)
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun initMediaSession() {
        if (mediaSession != null) return
        try {
            mediaSession = android.media.session.MediaSession(context, "StoryPhoneMediaSession").apply {
                setCallback(object : android.media.session.MediaSession.Callback() {
                    override fun onPlay() {
                        resumeMusicNatively()
                    }

                    override fun onPause() {
                        pauseMusicNatively()
                    }

                    override fun onStop() {
                        stopMusicNatively()
                    }

                    override fun onSeekTo(pos: Long) {
                        try {
                            mediaPlayer?.seekTo(pos.toInt())
                            updateMediaSessionState(android.media.session.PlaybackState.STATE_PLAYING)
                        } catch (e: Exception) { e.printStackTrace() }
                    }
                })
                isActive = true
            }
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun updateMediaSessionState(state: Int) {
        try {
            val mediaPlayer = this.mediaPlayer
            val position = mediaPlayer?.currentPosition?.toLong() ?: 0L
            val speed = if (state == android.media.session.PlaybackState.STATE_PLAYING) 1.0f else 0.0f
            
            val stateBuilder = android.media.session.PlaybackState.Builder()
                .setState(state, position, speed, android.os.SystemClock.elapsedRealtime())
                .setActions(
                    android.media.session.PlaybackState.ACTION_PLAY or
                    android.media.session.PlaybackState.ACTION_PAUSE or
                    android.media.session.PlaybackState.ACTION_STOP or
                    android.media.session.PlaybackState.ACTION_SEEK_TO
                )
            mediaSession?.setPlaybackState(stateBuilder.build())
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun updateMediaNotification(songName: String, isPlaying: Boolean) {
        if (mediaSession == null) return
        try {
            val channelId = "story_phone_media_channel"
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                var channel = notificationManager.getNotificationChannel(channelId)
                if (channel == null) {
                    channel = android.app.NotificationChannel(channelId, "音乐播放控制", android.app.NotificationManager.IMPORTANCE_LOW).apply {
                        description = "提供锁屏与下拉栏多媒体播放卡片控制"
                    }
                    notificationManager.createNotificationChannel(channel)
                }
            }

            val playPauseAction = if (isPlaying) {
                val intent = Intent("com.story.phone.ACTION_PAUSE")
                val pendingIntent = android.app.PendingIntent.getBroadcast(
                    context, 1, intent,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE else android.app.PendingIntent.FLAG_UPDATE_CURRENT
                )
                android.app.Notification.Action.Builder(
                    android.R.drawable.ic_media_pause, "暂停", pendingIntent
                ).build()
            } else {
                val intent = Intent("com.story.phone.ACTION_PLAY")
                val pendingIntent = android.app.PendingIntent.getBroadcast(
                    context, 1, intent,
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE else android.app.PendingIntent.FLAG_UPDATE_CURRENT
                )
                android.app.Notification.Action.Builder(
                    android.R.drawable.ic_media_play, "播放", pendingIntent
                ).build()
            }

            val stopIntent = Intent("com.story.phone.ACTION_STOP")
            val stopPendingIntent = android.app.PendingIntent.getBroadcast(
                context, 2, stopIntent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
            val stopAction = android.app.Notification.Action.Builder(
                android.R.drawable.ic_menu_close_clear_cancel, "停止", stopPendingIntent
            ).build()

            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val contentPendingIntent = android.app.PendingIntent.getActivity(
                context, 0, intent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )

            val mediaStyle = android.app.Notification.MediaStyle()
                .setMediaSession(mediaSession?.sessionToken)
                .setShowActionsInCompactView(0, 1)

            val smallIcon = try {
                context.resources.getDrawable(R.drawable.ic_launcher, context.theme)
                R.drawable.ic_launcher
            } catch (e: Exception) {
                android.R.drawable.ic_dialog_info
            }

            val notification = android.app.Notification.Builder(context, channelId)
                .setStyle(mediaStyle)
                .setSmallIcon(smallIcon)
                .setContentTitle(songName)
                .setContentText("叙事诗本地歌单")
                .setContentIntent(contentPendingIntent)
                .setOngoing(isPlaying)
                .apply {
                    addAction(playPauseAction)
                    addAction(stopAction)
                }
                .build()

            notificationManager.notify(1006, notification)
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun resetToDefaultNotification() {
        try {
            val channelId = "mcp_foreground_service_channel"
            val notificationManager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
            val intent = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val pendingIntent = android.app.PendingIntent.getActivity(
                context, 0, intent,
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) android.app.PendingIntent.FLAG_UPDATE_CURRENT or android.app.PendingIntent.FLAG_IMMUTABLE else android.app.PendingIntent.FLAG_UPDATE_CURRENT
            )
            
            val smallIcon = try {
                context.resources.getDrawable(R.drawable.ic_launcher, context.theme)
                R.drawable.ic_launcher
            } catch (e: Exception) {
                android.R.drawable.ic_dialog_info
            }

            val notification = android.app.Notification.Builder(context, channelId)
                .setContentTitle("叙事诗前台守护中")
                .setContentText("系统不休眠、歌单播放与后台发信功能保护中")
                .setSmallIcon(smallIcon)
                .setContentIntent(pendingIntent)
                .build()

            notificationManager.notify(1005, notification)
        } catch (e: Exception) { e.printStackTrace() }
    }

    fun resumeMusicNatively() {
        try {
            if (mediaPlayer?.isPlaying == false) {
                mediaPlayer?.start()
                updateMediaSessionState(android.media.session.PlaybackState.STATE_PLAYING)
                updateMediaNotification(currentSongName, true)
            }
        } catch (e: Exception) { e.printStackTrace() }
    }

    fun pauseMusicNatively() {
        try {
            if (mediaPlayer?.isPlaying == true) {
                mediaPlayer?.pause()
                updateMediaSessionState(android.media.session.PlaybackState.STATE_PAUSED)
                updateMediaNotification(currentSongName, false)
            }
        } catch (e: Exception) { e.printStackTrace() }
    }

    fun stopMusicNatively() {
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
            mediaPlayer = null
            updateMediaSessionState(android.media.session.PlaybackState.STATE_STOPPED)
            resetToDefaultNotification()
        } catch (e: Exception) { e.printStackTrace() }
    }

    // 3. Android 原生 MediaPlayer 后台音乐播放器
    @JavascriptInterface
    fun playNativeMusic(songName: String): Boolean {
        Log.d(TAG, "playNativeMusic() called, songName=$songName")
        return try {
            val musicFile = File(getMusicDir(), songName)
            if (!musicFile.exists()) return false

            mediaPlayer?.release()
            mediaPlayer = MediaPlayer().apply {
                setDataSource(musicFile.absolutePath)
                isLooping = true
                prepare()
                start()
            }
            currentSongName = songName
            
            initMediaSession()
            val metadata = android.media.MediaMetadata.Builder()
                .putString(android.media.MediaMetadata.METADATA_KEY_TITLE, songName)
                .putString(android.media.MediaMetadata.METADATA_KEY_ARTIST, "叙事诗本地歌单")
                .putLong(android.media.MediaMetadata.METADATA_KEY_DURATION, mediaPlayer?.duration?.toLong() ?: 0L)
                .build()
            mediaSession?.setMetadata(metadata)
            
            updateMediaSessionState(android.media.session.PlaybackState.STATE_PLAYING)
            updateMediaNotification(songName, true)
            
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    @JavascriptInterface
    fun pauseNativeMusic() {
        Log.d(TAG, "pauseNativeMusic() called")
        pauseMusicNatively()
    }

    @JavascriptInterface
    fun stopNativeMusic() {
        Log.d(TAG, "stopNativeMusic() called")
        stopMusicNatively()
    }

    // 4. 安卓真机马达物理震动桥接
    @JavascriptInterface
    fun triggerHardwareVibrator(milliseconds: Long) {
        Log.d(TAG, "triggerHardwareVibrator() called, milliseconds=$milliseconds")
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val vibratorManager = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager
                vibratorManager.defaultVibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
                vibrator.vibrate(VibrationEffect.createOneShot(milliseconds, VibrationEffect.DEFAULT_AMPLITUDE))
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 5. 调起系统通知监听设置页
    @JavascriptInterface
    fun requestNotificationPermission() {
        Log.d(TAG, "requestNotificationPermission() called")
        try {
            val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 6. 调起安卓系统无障碍辅助设置页
    @JavascriptInterface
    fun requestAccessibilityPermission() {
        Log.d(TAG, "requestAccessibilityPermission() called")
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 7. 原生写入真机物理闹钟
    @JavascriptInterface
    fun setAndroidSystemAlarm(hour: Int, minute: Int, message: String) {
        Log.d(TAG, "setAndroidSystemAlarm() called, hour=$hour, minute=$minute, message=$message")
        try {
            val intent = Intent(android.provider.AlarmClock.ACTION_SET_ALARM).apply {
                putExtra(android.provider.AlarmClock.EXTRA_HOUR, hour)
                putExtra(android.provider.AlarmClock.EXTRA_MINUTES, minute)
                putExtra(android.provider.AlarmClock.EXTRA_MESSAGE, message)
                putExtra(android.provider.AlarmClock.EXTRA_SKIP_UI, true)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 7.5 应用内定时闹钟：用 AlarmManager 在指定时间唤醒，到点发通知 + 振动 + 唤醒 WebView 发消息
    //     triggerTimeMillis 为绝对时间戳（System.currentTimeMillis() 语义）。
    //     与 setAndroidSystemAlarm（仅调起系统闹钟App）互补，前端可按需选用。
    @JavascriptInterface
    fun setInAppAlarm(triggerTimeMillis: Long, message: String): Boolean {
        Log.d(TAG, "setInAppAlarm() called, triggerTimeMillis=$triggerTimeMillis, message=${message.take(50)}")
        return try {
            if (triggerTimeMillis <= System.currentTimeMillis()) {
                Log.e(TAG, "setInAppAlarm() trigger time already passed, ignored.")
                return false
            }
            InAppAlarmReceiver.schedule(context, triggerTimeMillis, message)
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    // 7.6 取消应用内定时闹钟：通过相同 REQUEST_CODE 的 PendingIntent 取消 AlarmManager 调度。
    //     注意：仅能取消应用内闹钟通道，系统闹钟App的闹钟需用户手动删除。
    @JavascriptInterface
    fun cancelInAppAlarm(): Boolean {
        Log.d(TAG, "cancelInAppAlarm() called")
        return try {
            InAppAlarmReceiver.cancel(context)
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    private fun getWebView(): android.webkit.WebView? {
        return (context as? MainActivity)?.findViewById(R.id.webview)
    }

    private var floatPetView: android.view.View? = null
    private var petImageView: android.widget.ImageView? = null
    private var bubbleTextView: android.widget.TextView? = null
    private var hideBubbleRunnable: Runnable? = null

    // ============================================================
    //  后台主动发信 — Kotlin 原生定时 30 秒高强度唤醒心跳（直接物理击穿 WebView 冻结）
    // ============================================================

    @JavascriptInterface
    fun registerBgApiConfig(url: String, key: String, model: String, temperature: Double) {
        // 已全面升级为 JS 原生心跳调度，保留此接口防前端调用未定义崩溃
        Log.d(TAG, "registerBgApiConfig() no-op, integrated into JS Native Heartbeat")
    }

    @JavascriptInterface
    fun pushBgMessage(message: String) {
        // 已全面解耦，JS 心跳自主决策，保留此接口防崩溃
        Log.d(TAG, "pushBgMessage() no-op, integrated into JS Native Heartbeat")
    }

    @JavascriptInterface
    fun getBgPendingCount(): Int {
        return 0
    }

    @JavascriptInterface
    fun pollBgResult(): String? {
        return null
    }

    /**
     * 强力直写唤醒：改用 AlarmManager.setAndAllowWhileIdle 做后台心跳调度。
     * Doze 模式下 java.util.Timer 会被冻结，AlarmManager.RTC_WAKEUP 可在 Doze 下唤醒 CPU，
     * 并由 BgPollReceiver 链式重排下一次触发，强制向 WebView 注入心跳 JS。
     *
     * 注意：intervalMinutes 按分钟语义处理（与前端 toast "每隔 X 分钟" 一致），默认 10 分钟
     * （Doze 下 setAndAllowWhileIdle 最小调度窗口约 9 分钟，10 分钟可稳定触发）。
     */
    @JavascriptInterface
    fun startBackgroundPolling(intervalMinutes: Int) {
        Log.d(TAG, "startBackgroundPolling() called. AlarmManager-based heartbeat scheduling starting...")
        try {
            stopBackgroundPolling()
            val minutes = if (intervalMinutes > 0) intervalMinutes.toLong() else 10L
            val intervalMs = minutes * 60_000L
            BgPollReceiver.scheduleNextPoll(context, intervalMs)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @JavascriptInterface
    fun stopBackgroundPolling() {
        Log.d(TAG, "stopBackgroundPolling() called. Heartbeat polling stopped.")
        try {
            BgPollReceiver.cancelPoll(context)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 8. 获取真机当前电量百分比（0-100）
    @JavascriptInterface
    fun getBatteryLevel(): Int {
        return try {
            val bm = context.getSystemService(android.content.Context.BATTERY_SERVICE) as android.os.BatteryManager
            bm.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY)
        } catch (e: Exception) {
            e.printStackTrace()
            -1
        }
    }

    // 8.1 判断设备是否正在充电
    //    注意：BatteryManager.isCharging() 为 API 29+，minSdk=26 需做版本兼容降级。
    @JavascriptInterface
    fun isCharging(): Boolean {
        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val bm = context.getSystemService(android.content.Context.BATTERY_SERVICE) as android.os.BatteryManager
                bm.isCharging
            } else {
                // API 26-28：通过 ACTION_BATTERY_CHANGED 粘性广播判断充电状态
                val intent = context.registerReceiver(
                    null,
                    android.content.IntentFilter(android.content.Intent.ACTION_BATTERY_CHANGED)
                )
                val status = intent?.getIntExtra(android.os.BatteryManager.EXTRA_STATUS, -1) ?: -1
                status == android.os.BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == android.os.BatteryManager.BATTERY_STATUS_FULL
            }
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    // 9. 获取当前播放的媒体信息（仅本应用自身的 MediaSession，无需额外权限）
    //    返回 JSON: {"packageName":"com.story.phone","songName":"xxx","isPlaying":true}
    @JavascriptInterface
    fun getCurrentMediaInfo(): String {
        return try {
            val obj = JSONObject()
            obj.put("packageName", context.packageName)
            obj.put("songName", currentSongName)
            obj.put("isPlaying", mediaPlayer?.isPlaying == true)
            obj.toString()
        } catch (e: Exception) {
            e.printStackTrace()
            "{}"
        }
    }

    // 9.1 跳转到系统"通知使用权"设置页，授权后可读取其他 App 的媒体会话（敏感权限，用户主动开启）
    @JavascriptInterface
    fun requestNotificationListenerPermission() {
        Log.d(TAG, "requestNotificationListenerPermission() called")
        try {
            val intent = Intent("android.settings.ACTION_NOTIFICATION_LISTENER_SETTINGS").apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

// ============================================================
    //  桌面悬浮桌宠 (升级版：支持多状态复合控制、真机拖动过滤、双击跨进程反向唤醒、TextView原生冒泡)
    // ============================================================

    @JavascriptInterface
    fun checkOverlayPermission(): Boolean {
        val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(context)
        } else {
            true
        }
        Log.d(TAG, "checkOverlayPermission() called, returning $result")
        return result
    }

    @JavascriptInterface
    fun requestOverlayPermission() {
        Log.d(TAG, "requestOverlayPermission() called")
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).apply {
                data = android.net.Uri.parse("package:${context.packageName}")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(intent)
        }
    }

    @JavascriptInterface
    fun showDesktopPet(base64Str: String, sizeDp: Int) {
        Log.d(TAG, "showDesktopPet() called, sizeDp=$sizeDp, base64.length=${base64Str.length}")
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.post {
            try {
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
                
                val density = context.resources.displayMetrics.density
                val sizePx = (sizeDp * density).toInt()

                if (floatPetView == null) {
                    // 创建复合式 FrameLayout 悬浮容器
                    val layout = android.widget.FrameLayout(context)

                    // 1. 创建气泡 TextView，采用圆角白底描边风格
                    val bubble = android.widget.TextView(context).apply {
                        visibility = android.view.View.GONE
                        setTextColor(android.graphics.Color.BLACK)
                        setPadding((12 * density).toInt(), (8 * density).toInt(), (12 * density).toInt(), (8 * density).toInt())
                        textSize = 12f
                        maxWidth = (160 * density).toInt()
                        
                        val shape = android.graphics.drawable.GradientDrawable().apply {
                            setColor(android.graphics.Color.WHITE)
                            cornerRadius = 24f
                            setStroke(2, android.graphics.Color.parseColor("#e2e8f0")) // 浅灰描边
                        }
                        background = shape
                    }
                    val bubbleParams = android.widget.FrameLayout.LayoutParams(
                        android.widget.FrameLayout.LayoutParams.WRAP_CONTENT,
                        android.widget.FrameLayout.LayoutParams.WRAP_CONTENT
                    ).apply {
                        gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
                        bottomMargin = sizePx + (10 * density).toInt() // 居于桌宠上方
                    }
                    layout.addView(bubble, bubbleParams)
                    bubbleTextView = bubble

                    // 2. 创建图片 ImageView
                    val imageView = android.widget.ImageView(context).apply {
                        scaleType = android.widget.ImageView.ScaleType.FIT_CENTER
                    }
                    val petParams = android.widget.FrameLayout.LayoutParams(sizePx, sizePx).apply {
                        gravity = android.view.Gravity.BOTTOM or android.view.Gravity.CENTER_HORIZONTAL
                    }
                    layout.addView(imageView, petParams)
                    petImageView = imageView

                    val layoutParamsType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        android.view.WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
                    } else {
                        @Suppress("DEPRECATION")
                        android.view.WindowManager.LayoutParams.TYPE_PHONE
                    }

                    val params = android.view.WindowManager.LayoutParams(
                        android.view.WindowManager.LayoutParams.WRAP_CONTENT,
                        android.view.WindowManager.LayoutParams.WRAP_CONTENT,
                        layoutParamsType,
                        android.view.WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or android.view.WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                        android.graphics.PixelFormat.TRANSLUCENT
                    ).apply {
                        gravity = android.view.Gravity.TOP or android.view.Gravity.START
                        x = 100
                        y = 500
                    }

                    // 绑定拖拽滑动与双击判定
                    bindOverlayTouchListener(layout, params, windowManager)

                    windowManager.addView(layout, params)
                    floatPetView = layout
                } else {
                    // 更新现有容器的尺寸约束
                    petImageView?.layoutParams = petImageView?.layoutParams?.apply {
                        width = sizePx
                        height = sizePx
                    }
                    bubbleTextView?.layoutParams = (bubbleTextView?.layoutParams as? android.widget.FrameLayout.LayoutParams)?.apply {
                        bottomMargin = sizePx + (10 * density).toInt()
                    }
                    floatPetView?.let {
                        windowManager.updateViewLayout(it, it.layoutParams)
                    }
                }

                // 载入并解码 Base64 图像
                val cleanBase64 = base64Str.substringAfter("base64,")
                val decodedBytes = android.util.Base64.decode(cleanBase64, android.util.Base64.DEFAULT)
                val bitmap = android.graphics.BitmapFactory.decodeByteArray(decodedBytes, 0, decodedBytes.size)
                petImageView?.setImageBitmap(bitmap)

            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // 真机物理冒泡接口 [1]
    @JavascriptInterface
    fun showDesktopPetBubble(text: String, durationMs: Long) {
        Log.d(TAG, "showDesktopPetBubble() called, text=$text, durationMs=$durationMs")
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.post {
            try {
                if (bubbleTextView == null) return@post
                bubbleTextView?.text = text
                bubbleTextView?.visibility = android.view.View.VISIBLE

                hideBubbleRunnable?.let { handler.removeCallbacks(it) }
                val runnable = Runnable {
                    bubbleTextView?.visibility = android.view.View.GONE
                }
                hideBubbleRunnable = runnable
                handler.postDelayed(runnable, durationMs)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @JavascriptInterface
    fun updateDesktopPetSize(sizeDp: Int) {
        Log.d(TAG, "updateDesktopPetSize() called, sizeDp=$sizeDp")
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.post {
            try {
                val view = floatPetView ?: return@post
                val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
                val density = context.resources.displayMetrics.density
                val sizePx = (sizeDp * density).toInt()

                petImageView?.layoutParams = petImageView?.layoutParams?.apply {
                    width = sizePx
                    height = sizePx
                }
                bubbleTextView?.layoutParams = (bubbleTextView?.layoutParams as? android.widget.FrameLayout.LayoutParams)?.apply {
                    bottomMargin = sizePx + (10 * density).toInt()
                }

                val params = view.layoutParams as android.view.WindowManager.LayoutParams
                windowManager.updateViewLayout(view, params)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    @JavascriptInterface
    fun hideDesktopPet() {
        Log.d(TAG, "hideDesktopPet() called")
        val handler = android.os.Handler(android.os.Looper.getMainLooper())
        handler.post {
            try {
                if (floatPetView != null) {
                    val windowManager = context.getSystemService(Context.WINDOW_SERVICE) as android.view.WindowManager
                    windowManager.removeView(floatPetView)
                    floatPetView = null
                    petImageView = null
                    bubbleTextView = null
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    // 绑定物理触摸并滤除位移以解析双击
    private fun bindOverlayTouchListener(view: android.view.View, params: android.view.WindowManager.LayoutParams, windowManager: android.view.WindowManager) {
        view.setOnTouchListener(object : android.view.View.OnTouchListener {
            private var lastAction: Int = 0
            private var initialX: Int = 0
            private var initialY: Int = 0
            private var initialTouchX: Float = 0f
            private var initialTouchY: Float = 0f
            private var lastClickTime: Long = 0

            override fun onTouch(v: android.view.View?, event: android.view.MotionEvent?): Boolean {
                if (event == null) return false
                when (event.action) {
                    android.view.MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        lastAction = event.action
                        return true
                    }
                    android.view.MotionEvent.ACTION_UP -> {
                        val diffX = event.rawX - initialTouchX
                        val diffY = event.rawY - initialTouchY
                        
                        // 位移微弱，判定为非拖拽的点击
                        if (Math.abs(diffX) < 15 && Math.abs(diffY) < 15) {
                            val clickTime = System.currentTimeMillis()
                            if (clickTime - lastClickTime < 350) {
                                onOverlayDoubleClick() // 双击执行程序唤醒 [1]
                            }
                            lastClickTime = clickTime
                        }
                        lastAction = event.action
                        return true
                    }
                    android.view.MotionEvent.ACTION_MOVE -> {
                        params.x = initialX + (event.rawX - initialTouchX).toInt()
                        params.y = initialY + (event.rawY - initialTouchY).toInt()
                        try {
                            windowManager.updateViewLayout(view, params)
                        } catch (e: Exception) {}
                        lastAction = event.action
                        return true
                    }
                }
                return false
            }
        })
    }

// 双击真机悬浮窗：直接在后台安全评估 JS，不再强制启动 Activity 调起前台 [1]
    private fun onOverlayDoubleClick() {
        Log.d(TAG, "onOverlayDoubleClick() called, executing JS quietly in background")
        try {
            mainActivity?.runOnUiThread {
                getWebView()?.evaluateJavascript(
                    "javascript:if(window.desktopPetSystem) { window.desktopPetSystem.handleDoubleClickBackground(); }",
                    null
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }
    // ============================================================
    //  本地向量模型推理接口 (ONNX Runtime 核心推理与高保真自愈层)
    //  改造：模型不再默认打包在 assets 中，改为用户主动下载到 filesDir 后按需加载
    // ============================================================

    // 本地 ONNX 向量模型的下载源（all-MiniLM-L6-v2 量化版，384 维）
    // ★ 开源版说明：模型与词表均直接引用 HuggingFace 官方仓库 sentence-transformers/all-MiniLM-L6-v2
    //   本项目不托管、不分发该模型，下载与可用性由上游官方仓库负责，与本项目作者无关。
    //   如遇 HuggingFace 访问受限，请自行配置网络代理或更换为可访问的官方镜像。
    private val MODEL_DOWNLOAD_URL = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/onnx/model_quantized.onnx"
    // 词表同样使用 HuggingFace 官方地址，下载失败不影响推理（降级哈希分词）
    private val VOCAB_DOWNLOAD_URL = "https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/resolve/main/vocab.txt"
    private val LOCAL_MODEL_FILENAME = "model_quantized.onnx"
    private val LOCAL_VOCAB_FILENAME = "vocab.txt"

    private var ortEnv: ai.onnxruntime.OrtEnvironment? = null
    private var ortSession: ai.onnxruntime.OrtSession? = null
    private var modelFile: File? = null
    private var vocabMap: Map<String, Int>? = null

    /** 本地模型存储目录：filesDir/models/ */
    private fun getLocalModelDir(): File {
        val dir = File(context.filesDir, "models")
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    /** 本地模型文件路径：filesDir/models/model_quantized.onnx */
    private fun getLocalModelFile(): File {
        return File(getLocalModelDir(), LOCAL_MODEL_FILENAME)
    }

    /** 本地词表文件路径：filesDir/models/vocab.txt */
    private fun getLocalVocabFile(): File {
        return File(getLocalModelDir(), LOCAL_VOCAB_FILENAME)
    }

    /**
     * 检测本地 ONNX 向量模型是否已下载就绪。
     * 兼容老版本覆盖安装：自动从 cacheDir 或 assets 迁移模型到 filesDir。
     * 供前端 vectorMemorySystem._refreshLocalStatus() 调用。
     */
    @JavascriptInterface
    fun isLocalEmbeddingModelReady(): Boolean {
        return try {
            val localModel = getLocalModelFile()
            if (localModel.exists()) return true

            // 迁移路径1：老版本把模型复制到了 cacheDir，迁移到 filesDir
            val cacheModel = File(context.cacheDir, "model_quantized.onnx")
            if (cacheModel.exists()) {
                localModel.parentFile?.mkdirs()
                cacheModel.copyTo(localModel, overwrite = true)
                Log.d(TAG, "从 cacheDir 迁移 ONNX 模型到 filesDir: ${localModel.absolutePath}")
                return true
            }

            // 迁移路径2：更老版本把模型打包在 assets 里，提取到 filesDir
            try {
                context.assets.open("models/model_quantized.onnx").use { input ->
                    localModel.parentFile?.mkdirs()
                    localModel.outputStream().use { output ->
                        input.copyTo(output)
                    }
                }
                Log.d(TAG, "从 assets 迁移 ONNX 模型到 filesDir: ${localModel.absolutePath}")
                return true
            } catch (assetErr: Exception) {
                // assets 里也没有模型，需要用户主动下载
            }

            // 同步迁移词表 vocab.txt（从 cacheDir 或 assets）
            val localVocab = getLocalVocabFile()
            if (!localVocab.exists()) {
                val cacheVocab = File(context.cacheDir, "vocab.txt")
                if (cacheVocab.exists()) {
                    localVocab.parentFile?.mkdirs()
                    cacheVocab.copyTo(localVocab, overwrite = true)
                } else {
                    try {
                        context.assets.open("models/vocab.txt").use { input ->
                            localVocab.parentFile?.mkdirs()
                            localVocab.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }
                    } catch (ve: Exception) { /* 词表缺失不阻断，会降级哈希分词 */ }
                }
            }

            false
        } catch (e: Exception) {
            Log.e(TAG, "isLocalEmbeddingModelReady() 检测失败: ${e.message}")
            false
        }
    }

    /**
     * 主动下载本地 ONNX 向量大模型（后台线程执行，带实时进度回调）。
     * 下载完成后自动保存到 filesDir/models/，并重置 ONNX session 以便下次加载。
     * 供前端 vectorMemorySystem.downloadLocalModel() 调用。
     * 进度通过 evaluateJavascript 调用 window.onEmbeddingModelDownloadProgress(stage, percent, downloaded, total, error) 实时回传前端。
     */
    @JavascriptInterface
    fun downloadLocalEmbeddingModel(): Boolean {
        return try {
            val modelFile = getLocalModelFile()
            val vocabFile = getLocalVocabFile()

            Thread {
                try {
                    modelFile.parentFile?.mkdirs()
                    val activity = mainActivity

                    // 1. 下载 ONNX 模型（带进度）
                    Log.d(TAG, "开始下载本地 ONNX 向量模型: $MODEL_DOWNLOAD_URL")
                    val modelUrl = java.net.URL(MODEL_DOWNLOAD_URL)
                    val conn = modelUrl.openConnection() as java.net.HttpURLConnection
                    conn.connectTimeout = 30000
                    conn.readTimeout = 60000
                    conn.instanceFollowRedirects = true
                    val totalModelBytes = conn.contentLengthLong  // 可能返回-1（未知）
                    var downloadedModelBytes = 0L
                    val buffer = ByteArray(8192)
                    var lastReportPercent = -1

                    conn.inputStream.use { input ->
                        modelFile.outputStream().use { output ->
                            while (true) {
                                val read = input.read(buffer)
                                if (read <= 0) break
                                output.write(buffer, 0, read)
                                downloadedModelBytes += read

                                // 计算进度并回调（每变化2%回调一次，避免频繁evaluateJavascript）
                                if (totalModelBytes > 0) {
                                    val percent = (downloadedModelBytes * 100 / totalModelBytes).toInt()
                                    if (percent >= lastReportPercent + 2 || percent == 100) {
                                        lastReportPercent = percent
                                        reportDownloadProgress(activity, "downloading_model", percent, downloadedModelBytes, totalModelBytes, null)
                                    }
                                } else {
                                    // 总大小未知，每下载100KB回调一次
                                    if (downloadedModelBytes - (lastReportPercent * 10240L) >= 100 * 1024) {
                                        lastReportPercent = (downloadedModelBytes / 10240).toInt()
                                        reportDownloadProgress(activity, "downloading_model", -1, downloadedModelBytes, 0, null)
                                    }
                                }
                            }
                        }
                    }
                    Log.d(TAG, "ONNX 模型下载完成: ${modelFile.absolutePath}, 大小=${modelFile.length() / 1024}KB")
                    reportDownloadProgress(activity, "downloading_model", 100, modelFile.length(), modelFile.length(), null)

                    // 2. 下载词表 vocab.txt（失败不阻断，会降级为哈希分词）
                    reportDownloadProgress(activity, "downloading_vocab", 0, 0, 0, null)
                    try {
                        val vocabUrl = java.net.URL(VOCAB_DOWNLOAD_URL)
                        val vocabConn = vocabUrl.openConnection() as java.net.HttpURLConnection
                        vocabConn.connectTimeout = 15000
                        vocabConn.readTimeout = 15000
                        vocabConn.instanceFollowRedirects = true
                        vocabConn.inputStream.use { input ->
                            vocabFile.outputStream().use { output ->
                                input.copyTo(output)
                            }
                        }
                        Log.d(TAG, "词表下载完成: ${vocabFile.absolutePath}")
                        reportDownloadProgress(activity, "downloading_vocab", 100, vocabFile.length(), vocabFile.length(), null)
                    } catch (ve: Exception) {
                        Log.w(TAG, "词表下载失败（不影响模型推理，将降级哈希分词）: ${ve.message}")
                    }

                    // 3. 重置 session，以便下次 getEmbedding 时重新加载
                    reportDownloadProgress(activity, "installing", 0, 0, 0, null)
                    synchronized(this) {
                        try { ortSession?.close() } catch (_: Exception) {}
                        ortSession = null
                        vocabMap = null
                    }

                    // 4. 通知前端下载完成
                    reportDownloadProgress(activity, "done", 100, modelFile.length(), modelFile.length(), null)
                } catch (e: Exception) {
                    Log.e(TAG, "下载本地 ONNX 向量模型失败: ${e.message}", e)
                    reportDownloadProgress(mainActivity, "error", 0, 0, 0, e.message ?: "未知错误")
                    // 清理半成品文件
                    try { if (getLocalModelFile().exists() && getLocalModelFile().length() == 0L) getLocalModelFile().delete() } catch (_: Exception) {}
                }
            }.start()
            true
        } catch (e: Exception) {
            Log.e(TAG, "downloadLocalEmbeddingModel() 启动失败: ${e.message}", e)
            false
        }
    }

    /**
     * 向前端回传下载进度（通过 evaluateJavascript 调用 window.onEmbeddingModelDownloadProgress）。
     */
    private fun reportDownloadProgress(activity: android.app.Activity?, stage: String, percent: Int, downloaded: Long, total: Long, error: String?) {
        if (activity == null) return
        try {
            activity.runOnUiThread {
                try {
                    val webView = getWebView() ?: return@runOnUiThread
                    val p = if (percent < 0) 0 else percent
                    val errJson = if (error != null) org.json.JSONObject.quote(error) else "null"
                    val js = "javascript:if(window.onEmbeddingModelDownloadProgress){window.onEmbeddingModelDownloadProgress(${org.json.JSONObject.quote(stage)},$p,$downloaded,$total,$errJson);}"
                    webView.evaluateJavascript(js, null)
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    @Synchronized
    private fun initOnnxSession() {
        if (ortSession != null) return
        try {
            val localModel = getLocalModelFile()
            if (!localModel.exists()) {
                // 模型未下载，不再从 assets 自动复制
                Log.w(TAG, "本地 ONNX 模型未下载，请在「向量化记忆设置」中主动下载。")
                return
            }
            ortEnv = ai.onnxruntime.OrtEnvironment.getEnvironment()
            modelFile = localModel
            ortSession = ortEnv?.createSession(localModel.absolutePath)
            Log.d(TAG, "ONNX Runtime model successfully loaded from: ${localModel.absolutePath}")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize ONNX session: ${e.message}", e)
        }
    }

    private fun loadVocabIfNeeded() {
        if (vocabMap != null) return
        val map = HashMap<String, Int>()
        try {
            val vocabFile = getLocalVocabFile()
            if (vocabFile.exists()) {
                vocabFile.bufferedReader().useLines { lines ->
                    lines.forEachIndexed { index, line ->
                        map[line.trim()] = index
                    }
                }
                vocabMap = map
                Log.d(TAG, "Successfully loaded vocabulary from filesDir: ${map.size} tokens.")
            } else {
                Log.d(TAG, "Vocabulary file not found in filesDir, using fallback hash mapping.")
            }
        } catch (e: Exception) {
            Log.d(TAG, "Failed to load vocabulary, using fallback hash mapping: ${e.message}")
        }
    }

    private fun tokenizeStringToIds(text: String): List<Int> {
        loadVocabIfNeeded()
        val ids = ArrayList<Int>()
        ids.add(101) // [CLS] token
        
        val cleanedText = text.lowercase().replace(Regex("[\\s\\p{Punct}]+"), " ")
        val words = cleanedText.split(" ").filter { it.isNotEmpty() }
        
        val vocab = vocabMap
        if (vocab != null) {
            for (word in words) {
                if (vocab.containsKey(word)) {
                    ids.add(vocab[word]!!)
                } else {
                    var temp = word
                    var foundSub = false
                    while (temp.isNotEmpty()) {
                        if (vocab.containsKey(temp)) {
                            ids.add(vocab[temp]!!)
                            foundSub = true
                            break
                        }
                        temp = temp.substring(0, temp.length - 1)
                    }
                    if (!foundSub) {
                        ids.add(100) // [UNK] token
                    }
                }
            }
        } else {
            for (word in words) {
                val id = (Math.abs(word.hashCode()) % 29000) + 1000
                ids.add(id)
            }
        }
        
        ids.add(102) // [SEP] token
        return ids
    }

    private fun extractFloatsFromNestedArray(array: Any): List<Float> {
        val result = ArrayList<Float>()
        fun recurse(item: Any) {
            if (item is FloatArray) {
                item.forEach { result.add(it) }
            } else if (item is Array<*>) {
                item.forEach { it?.let { recurse(it) } }
            }
        }
        recurse(array)
        return result
    }

    private fun performMeanPoolingAndNormalize(outputValue: Array<*>): List<Float> {
        try {
            val batch = outputValue[0] as Array<*>
            val seqLen = batch.size
            if (seqLen == 0) return emptyList()
            
            val hiddenDim = (batch[0] as FloatArray).size
            val sumVector = FloatArray(hiddenDim)
            
            for (i in 0 until seqLen) {
                val stepFeatures = batch[i] as FloatArray
                for (j in 0 until hiddenDim) {
                    sumVector[j] += stepFeatures[j]
                }
            }
            
            val meanVector = FloatArray(hiddenDim)
            for (j in 0 until hiddenDim) {
                meanVector[j] = sumVector[j] / seqLen
            }
            
            return normalizeVector(meanVector)
        } catch (e: Exception) {
            val raw = extractFloatsFromNestedArray(outputValue)
            if (raw.size >= 384) {
                return normalizeVector(raw.take(384).toFloatArray())
            }
            return raw
        }
    }

    private fun generateDeterministicSemanticVector(text: String): List<Float> {
        val dimensions = 384
        val vector = FloatArray(dimensions)
        
        val cleanedText = text.lowercase().replace(Regex("[\\s\\p{Punct}]+"), " ")
        val words = cleanedText.split(" ").filter { it.isNotEmpty() }
        
        if (words.isEmpty()) {
            val random = java.util.Random(text.hashCode().toLong())
            for (i in 0 until dimensions) {
                vector[i] = random.nextFloat() * 0.01f
            }
            return normalizeVector(vector)
        }

        for (word in words) {
            val random = java.util.Random(word.hashCode().toLong())
            for (i in 0 until dimensions) {
                val projection = (random.nextFloat() * 2.0f - 1.0f)
                vector[i] += projection
            }
        }

        for (i in 0 until text.length - 1) {
            val ngram = text.substring(i, i + 2)
            val random = java.util.Random(ngram.hashCode().toLong())
            for (j in 0 until dimensions) {
                val projection = (random.nextFloat() * 2.0f - 1.0f) * 0.3f
                vector[j] += projection
            }
        }

        return normalizeVector(vector)
    }

    private fun normalizeVector(vector: FloatArray): List<Float> {
        var sumSq = 0.0f
        for (v in vector) {
            sumSq += v * v
        }
        val norm = Math.sqrt(sumSq.toDouble()).toFloat()
        if (norm == 0.0f) {
            return vector.toList()
        }
        return vector.map { it / norm }
    }

    @JavascriptInterface
    fun testOnnxModel(): String {
        return try {
            val modelFile = getLocalModelFile()
            if (modelFile.exists()) {
                "✅ 本地模型已下载！大小: ${modelFile.length() / 1024} KB，路径: ${modelFile.absolutePath}"
            } else {
                "❌ 本地模型未下载，请在「向量化记忆设置」中点击下载。"
            }
        } catch (e: Exception) {
            "❌ 检测本地模型失败: ${e.message}"
        }
    }

    @JavascriptInterface
    fun getEmbedding(text: String): String {
        Log.d(TAG, "getEmbedding() called with text: ${text.take(50)}")
        if (text.isEmpty()) return "[]"
        
        try {
            if (ortSession == null) {
                initOnnxSession()
            }
            
            val session = ortSession
            val env = ortEnv
            
            // 模型未下载就绪时返回空数组，让前端降级到在线 Embedding API
            if (session == null || env == null) {
                Log.w(TAG, "本地 ONNX 模型未就绪，返回空向量（前端将降级到在线 API）")
                return "[]"
            }
            
            if (session != null && env != null) {
                val inputNames = session.inputNames
                val inputs = HashMap<String, ai.onnxruntime.OnnxTensor>()
                
                if (inputNames.size == 1 && session.inputInfo[inputNames.first()]?.info?.toString()?.contains("string", true) == true) {
                    val stringInput = arrayOf(text)
                    val tensor = ai.onnxruntime.OnnxTensor.createTensor(env, stringInput)
                    inputs[inputNames.first()] = tensor
                    
                    session.run(inputs).use { results ->
                        val outputValue = results[0].value
                        if (outputValue is Array<*>) {
                            val floatArray = extractFloatsFromNestedArray(outputValue)
                            return floatArray.toString()
                        }
                    }
                } else {
                    val tokenIds = tokenizeStringToIds(text)
                    val sequenceLength = tokenIds.size
                    
                    val inputIdsArray = LongArray(sequenceLength) { tokenIds[it].toLong() }
                    val attentionMaskArray = LongArray(sequenceLength) { 1L }
                    val tokenTypeIdsArray = LongArray(sequenceLength) { 0L }
                    
                    val shape = longArrayOf(1, sequenceLength.toLong())
                    
                    inputs["input_ids"] = ai.onnxruntime.OnnxTensor.createTensor(env, java.nio.LongBuffer.wrap(inputIdsArray), shape)
                    if (inputNames.contains("attention_mask")) {
                        inputs["attention_mask"] = ai.onnxruntime.OnnxTensor.createTensor(env, java.nio.LongBuffer.wrap(attentionMaskArray), shape)
                    }
                    if (inputNames.contains("token_type_ids")) {
                        inputs["token_type_ids"] = ai.onnxruntime.OnnxTensor.createTensor(env, java.nio.LongBuffer.wrap(tokenTypeIdsArray), shape)
                    }
                    
                    session.run(inputs).use { results ->
                        val outputValue = results[0].value
                        if (outputValue is Array<*>) {
                            val floatArray = extractFloatsFromNestedArray(outputValue)
                            val finalVector = if (results[0].info.toString().contains("seq") || (outputValue.size == 1 && outputValue[0] is Array<*> && (outputValue[0] as Array<*>)[0] is FloatArray)) {
                                performMeanPoolingAndNormalize(outputValue)
                            } else {
                                floatArray
                            }
                            return finalVector.toString()
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "ONNX Runtime inference failed, falling back to deterministic semantic hashing: ${e.message}", e)
        }
        
        val fallbackVector = generateDeterministicSemanticVector(text)
        return fallbackVector.toString()
    }
}