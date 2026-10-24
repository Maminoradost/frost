package app.frost.mobile

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.support.v4.media.MediaMetadataCompat
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Base64
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/** Что сейчас играет: присылает фронтенд (audio/mediaSession.ts). */
data class Snapshot(
    val title: String = "",
    val artist: String = "",
    val album: String = "",
    val artwork: String? = null,
    val durationMs: Long = -1L,
    val positionMs: Long = 0L,
    val playing: Boolean = false,
    val rate: Float = 1f,
    val hasNext: Boolean = true,
    val hasPrevious: Boolean = true,
)

/**
 * Сам звук играет в WebView. Здесь его «представительство» для системы:
 * MediaSession (шторка, экран блокировки, Bluetooth, часы), пауза при отключении
 * наушников и уведомление для фонового сервиса.
 *
 * Аудиофокус здесь не запрашивается: его уже берёт WebView, когда играет звук,
 * и сам ставит паузу при звонке или чужой музыке. Второй запрос из того же
 * приложения отнял бы фокус у WebView, и она остановила бы воспроизведение.
 * Все изменения состояния выполняются на главном потоке.
 */
object FrostPlayback {
    const val CHANNEL_ID = "frost_playback"
    const val NOTIFICATION_ID = 7310
    private const val ARTWORK_MAX = 512

    /** Команды от системы во фронтенд: play, pause, next, previous, seek. */
    @Volatile
    var listener: ((String, Double?) -> Unit)? = null

    @Volatile
    var state = Snapshot()
        private set

    @Volatile
    var active = false
        private set

    @Volatile
    var artwork: Bitmap? = null
        private set

    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private var appContext: Context? = null
    private var session: MediaSessionCompat? = null
    private var artworkUrl: String? = null
    private var noisyRegistered = false

    private val callback = object : MediaSessionCompat.Callback() {
        override fun onPlay() {
            emit("play")
        }

        override fun onPause() {
            emit("pause")
        }

        override fun onStop() {
            emit("pause")
        }

        override fun onSkipToNext() {
            emit("next")
        }

        override fun onSkipToPrevious() {
            emit("previous")
        }

        override fun onSeekTo(pos: Long) {
            emit("seek", pos / 1000.0)
        }
    }

    private val noisyReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == AudioManager.ACTION_AUDIO_BECOMING_NOISY) emit("pause")
        }
    }

    fun emit(action: String, position: Double? = null) {
        main.post { listener?.invoke(action, position) }
    }

    fun session(context: Context): MediaSessionCompat {
        session?.let { return it }
        val created = MediaSessionCompat(context.applicationContext, "Frost")
        created.setCallback(callback, main)
        contentIntent(context)?.let { created.setSessionActivity(it) }
        session = created
        return created
    }

    fun update(context: Context, next: Snapshot) {
        main.post {
            val ctx = context.applicationContext
            appContext = ctx
            val prev = state
            state = next
            active = true

            val current = session(ctx)
            if (!current.isActive) current.isActive = true

            val artworkChanged = prev.artwork != next.artwork || artworkUrl != next.artwork
            val visualChanged = artworkChanged ||
                prev.title != next.title ||
                prev.artist != next.artist ||
                prev.album != next.album ||
                prev.playing != next.playing ||
                prev.durationMs != next.durationMs ||
                prev.hasNext != next.hasNext ||
                prev.hasPrevious != next.hasPrevious ||
                !PlaybackService.running

            if (artworkChanged) {
                artwork = null
                loadArtwork(ctx, next.artwork)
            }
            if (visualChanged) current.setMetadata(metadata())
            current.setPlaybackState(playbackState())

            setNoisyReceiver(ctx, next.playing)
            if (visualChanged) PlaybackService.sync(ctx)
        }
    }

    fun clear(context: Context) {
        main.post {
            val ctx = context.applicationContext
            state = Snapshot()
            active = false
            artwork = null
            artworkUrl = null
            session?.let {
                it.isActive = false
                it.release()
            }
            session = null
            setNoisyReceiver(ctx, false)
            PlaybackService.stop(ctx)
        }
    }

    @SuppressLint("MissingPermission")
    fun notification(context: Context): Notification {
        ensureChannel(context)
        val s = state
        val style = androidx.media.app.NotificationCompat.MediaStyle()
            .setMediaSession(session(context).sessionToken)
            .setShowActionsInCompactView(0, 1, 2)
        val builder = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_frost_notification)
            .setContentTitle(s.title.ifEmpty { "Frost" })
            .setContentText(s.artist)
            .setLargeIcon(artwork)
            .setDeleteIntent(PlaybackService.action(context, PlaybackService.ACTION_DISMISS))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setSilent(true)
            .setOngoing(s.playing)
            .addAction(
                R.drawable.ic_frost_previous,
                "Предыдущий",
                PlaybackService.action(context, PlaybackService.ACTION_PREVIOUS),
            )
            .addAction(
                if (s.playing) R.drawable.ic_frost_pause else R.drawable.ic_frost_play,
                if (s.playing) "Пауза" else "Играть",
                PlaybackService.action(context, PlaybackService.ACTION_TOGGLE),
            )
            .addAction(
                R.drawable.ic_frost_next,
                "Следующий",
                PlaybackService.action(context, PlaybackService.ACTION_NEXT),
            )
            .setStyle(style)
        contentIntent(context)?.let { builder.setContentIntent(it) }
        return builder.build()
    }

    private fun metadata(): MediaMetadataCompat {
        val s = state
        val builder = MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, s.artist)
            .putString(MediaMetadataCompat.METADATA_KEY_ALBUM, s.album)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, s.title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, s.artist)
            .putLong(MediaMetadataCompat.METADATA_KEY_DURATION, s.durationMs)
        artwork?.let { builder.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, it) }
        return builder.build()
    }

    private fun playbackState(): PlaybackStateCompat {
        val s = state
        var actions = PlaybackStateCompat.ACTION_PLAY or
            PlaybackStateCompat.ACTION_PAUSE or
            PlaybackStateCompat.ACTION_PLAY_PAUSE or
            PlaybackStateCompat.ACTION_STOP
        if (s.durationMs > 0) actions = actions or PlaybackStateCompat.ACTION_SEEK_TO
        if (s.hasNext) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_NEXT
        if (s.hasPrevious) actions = actions or PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        val code = if (s.playing) PlaybackStateCompat.STATE_PLAYING else PlaybackStateCompat.STATE_PAUSED
        return PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(code, s.positionMs, if (s.playing) s.rate else 0f, SystemClock.elapsedRealtime())
            .build()
    }

    private fun contentIntent(context: Context): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        return PendingIntent.getActivity(
            context,
            0,
            launch,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }

    private fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL_ID) != null) return
        val channel = NotificationChannel(CHANNEL_ID, "Воспроизведение", NotificationManager.IMPORTANCE_LOW)
        channel.description = "Управление музыкой в шторке и на экране блокировки"
        channel.setShowBadge(false)
        channel.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        manager.createNotificationChannel(channel)
    }

    private fun setNoisyReceiver(context: Context, enabled: Boolean) {
        if (enabled == noisyRegistered) return
        if (enabled) {
            ContextCompat.registerReceiver(
                context,
                noisyReceiver,
                IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
                ContextCompat.RECEIVER_NOT_EXPORTED,
            )
        } else {
            runCatching { context.unregisterReceiver(noisyReceiver) }
        }
        noisyRegistered = enabled
    }

    private fun loadArtwork(context: Context, url: String?) {
        artworkUrl = url
        if (url.isNullOrBlank()) return
        io.execute {
            val bitmap = runCatching { decode(url) }.getOrNull()?.let { scale(it) }
            main.post {
                if (artworkUrl != url || !active) return@post
                artwork = bitmap
                session?.setMetadata(metadata())
                PlaybackService.sync(context.applicationContext)
            }
        }
    }

    private fun decode(url: String): Bitmap? {
        return when {
            url.startsWith("data:") -> {
                val comma = url.indexOf(',')
                if (comma < 0) {
                    null
                } else {
                    val bytes = Base64.decode(url.substring(comma + 1), Base64.DEFAULT)
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
                }
            }
            // convertFileSrc() на Android: http://asset.localhost/<путь в кодировке URL>
            url.startsWith("http://asset.localhost/") || url.startsWith("asset://localhost/") -> {
                val path = Uri.decode(url.substringAfter("localhost/").substringBefore('?'))
                BitmapFactory.decodeFile(if (path.startsWith("/")) path else "/$path")
            }
            url.startsWith("/") -> BitmapFactory.decodeFile(url)
            url.startsWith("http://") || url.startsWith("https://") -> {
                val connection = URL(url).openConnection() as HttpURLConnection
                connection.connectTimeout = 8000
                connection.readTimeout = 8000
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android) Frost")
                try {
                    connection.inputStream.use { BitmapFactory.decodeStream(it) }
                } finally {
                    connection.disconnect()
                }
            }
            else -> null
        }
    }

    /** Большие картинки не пролезают через Binder (лимит ~1 МБ), уменьшаем до 512 px. */
    private fun scale(bitmap: Bitmap): Bitmap {
        val width = bitmap.width
        val height = bitmap.height
        if (width <= ARTWORK_MAX && height <= ARTWORK_MAX) return bitmap
        val k = ARTWORK_MAX.toFloat() / maxOf(width, height)
        return Bitmap.createScaledBitmap(
            bitmap,
            (width * k).toInt().coerceAtLeast(1),
            (height * k).toInt().coerceAtLeast(1),
            true,
        )
    }
}
