package app.frost.mobile

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat

/**
 * Foreground-сервис «mediaPlayback»: пока играет музыка, Android не выгружает процесс
 * с WebView, а в шторке и на экране блокировки висит плеер. На паузе сервис
 * снимает статус foreground, и уведомление можно смахнуть.
 */
class PlaybackService : Service() {
    companion object {
        const val ACTION_FOREGROUND = "app.frost.mobile.FOREGROUND"
        const val ACTION_REFRESH = "app.frost.mobile.REFRESH"
        const val ACTION_TOGGLE = "app.frost.mobile.TOGGLE"
        const val ACTION_NEXT = "app.frost.mobile.NEXT"
        const val ACTION_PREVIOUS = "app.frost.mobile.PREVIOUS"
        const val ACTION_DISMISS = "app.frost.mobile.DISMISS"

        @Volatile
        var running = false
            private set

        fun action(context: Context, action: String): PendingIntent {
            val intent = Intent(context, PlaybackService::class.java).setAction(action)
            return PendingIntent.getService(
                context,
                action.hashCode(),
                intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        /** Привести сервис и уведомление в соответствие с FrostPlayback.state. */
        fun sync(context: Context) {
            val intent = Intent(context, PlaybackService::class.java)
            when {
                FrostPlayback.state.playing -> {
                    intent.action = ACTION_FOREGROUND
                    try {
                        ContextCompat.startForegroundService(context, intent)
                    } catch (e: Exception) {
                        // Android 12+: из фона foreground-сервис запускать нельзя. Музыка продолжит
                        // играть, пока жив процесс, а управление останется в уведомлении.
                        postNotification(context)
                    }
                }
                running -> {
                    intent.action = ACTION_REFRESH
                    try {
                        context.startService(intent)
                    } catch (e: Exception) {
                        postNotification(context)
                    }
                }
                FrostPlayback.active -> postNotification(context)
            }
        }

        fun stop(context: Context) {
            if (running) context.stopService(Intent(context, PlaybackService::class.java))
            NotificationManagerCompat.from(context).cancel(FrostPlayback.NOTIFICATION_ID)
        }

        /** Медиа-уведомления с MediaSession не требуют POST_NOTIFICATIONS на Android 13+. */
        @SuppressLint("MissingPermission")
        fun postNotification(context: Context) {
            runCatching {
                NotificationManagerCompat.from(context)
                    .notify(FrostPlayback.NOTIFICATION_ID, FrostPlayback.notification(context))
            }
        }
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onCreate() {
        super.onCreate()
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action
        // Сервис запущен через startForegroundService: обещание системе надо выполнить сразу.
        if (action == ACTION_FOREGROUND) goForeground()
        when (action) {
            ACTION_TOGGLE -> FrostPlayback.emit(if (FrostPlayback.state.playing) "pause" else "play")
            ACTION_NEXT -> FrostPlayback.emit("next")
            ACTION_PREVIOUS -> FrostPlayback.emit("previous")
            ACTION_DISMISS -> if (!FrostPlayback.state.playing) {
                stopSelf()
                return START_NOT_STICKY
            }
        }
        refresh()
        return START_NOT_STICKY
    }

    private fun refresh() {
        if (!FrostPlayback.active) {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            stopSelf()
            return
        }
        if (FrostPlayback.state.playing) {
            goForeground()
        } else {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH)
            postNotification(this)
            releaseLocks()
        }
    }

    private fun goForeground() {
        val notification = FrostPlayback.notification(this)
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
            } else {
                0
            }
            ServiceCompat.startForeground(this, FrostPlayback.NOTIFICATION_ID, notification, type)
            acquireLocks()
        } catch (e: Exception) {
            postNotification(this)
        }
    }

    @Suppress("DEPRECATION")
    @SuppressLint("WakelockTimeout")
    private fun acquireLocks() {
        if (wakeLock == null) {
            val power = getSystemService(Context.POWER_SERVICE) as? PowerManager
            wakeLock = power?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Frost:playback")?.apply {
                setReferenceCounted(false)
            }
        }
        // С запасом на длинный плейлист; продлевается при каждом обновлении состояния.
        wakeLock?.acquire(4 * 60 * 60 * 1000L)
        if (wifiLock == null) {
            val wifi = applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            wifiLock = wifi?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "Frost:playback")?.apply {
                setReferenceCounted(false)
            }
        }
        wifiLock?.let { if (!it.isHeld) it.acquire() }
    }

    private fun releaseLocks() {
        wakeLock?.let { if (it.isHeld) it.release() }
        wifiLock?.let { if (it.isHeld) it.release() }
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Плеер живёт в WebView окна: задачу смахнули, значит звук уже остановлен.
        FrostPlayback.clear(this)
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        releaseLocks()
        running = false
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
