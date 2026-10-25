package app.frost.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import android.speech.RecognizerIntent
import android.view.HapticFeedbackConstants
import android.view.WindowManager
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import app.tauri.PermissionState
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File

@InvokeArg
class SessionArgs {
    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var artwork: String? = null
    /** Секунды. */
    var duration: Double? = null
    /** Секунды. */
    var position: Double? = null
    var playing: Boolean = false
    var rate: Double? = null
    var hasNext: Boolean = true
    var hasPrevious: Boolean = true
}

@InvokeArg
class SystemBarsArgs {
    /** true: светлая тема, значит тёмные значки в строке состояния. */
    var light: Boolean = false
}

@InvokeArg
class FlagArgs {
    var enabled: Boolean = false
}

@InvokeArg
class PathArgs {
    var path: String = ""
}

@InvokeArg
class ShareArgs {
    var text: String = ""
    var title: String? = null
}

@InvokeArg
class SaveDocumentArgs {
    var name: String = "frost.json"
    var mime: String = "application/json"
    var contents: String = ""
}

@TauriPlugin(
    permissions = [
        Permission(strings = [Manifest.permission.READ_MEDIA_AUDIO], alias = "audio"),
        Permission(strings = [Manifest.permission.READ_EXTERNAL_STORAGE], alias = "storage"),
    ],
)
@InvokeArg
class HapticArgs {
    var kind: String? = null
}

@InvokeArg
class VoiceArgs {
    var prompt: String? = null
}

class FrostMobilePlugin(private val activity: Activity) : Plugin(activity) {
    private var webView: WebView? = null
    private var insets = JSObject()

    /** Ссылка, с которой открыли Frost («Поделиться» или переход по ссылке), пока её не забрал фронтенд. */
    private var pendingLink: String? = null

    /** «Назад» решает фронтенд: закрыть шторку, вернуться по истории или свернуть приложение. */
    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            if (hasListener("back")) {
                trigger("back", JSObject())
                return
            }
            // Фронтенд ещё не загрузился: обычное поведение Tauri.
            isEnabled = false
            (activity as? ComponentActivity)?.onBackPressedDispatcher?.onBackPressed()
            isEnabled = true
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)
        this.webView = webView
        pendingLink = linkFrom(activity.intent)
        FrostPlayback.listener = { action, position ->
            val payload = JSObject()
            payload.put("action", action)
            if (position != null) payload.put("position", position)
            trigger("media", payload)
        }
        activity.runOnUiThread {
            (activity as? ComponentActivity)?.let { owner ->
                owner.onBackPressedDispatcher.addCallback(owner, backCallback)
            }
            ViewCompat.setOnApplyWindowInsetsListener(webView) { view, windowInsets ->
                publishInsets(windowInsets)
                ViewCompat.onApplyWindowInsets(view, windowInsets)
            }
            ViewCompat.requestApplyInsets(webView)
        }
    }

    /** Отступы системных панелей и клавиатуры в CSS-пикселях. */
    private fun publishInsets(windowInsets: WindowInsetsCompat) {
        val density = activity.resources.displayMetrics.density
        val bars = windowInsets.getInsets(
            WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout(),
        )
        val ime = windowInsets.getInsets(WindowInsetsCompat.Type.ime())
        val next = JSObject()
        next.put("top", (bars.top / density).toDouble())
        next.put("bottom", (bars.bottom / density).toDouble())
        next.put("left", (bars.left / density).toDouble())
        next.put("right", (bars.right / density).toDouble())
        next.put("ime", (ime.bottom / density).toDouble())
        insets = next
        // Сразу в CSS: так раскладка верна ещё до того, как JS подпишется на событие.
        val css = "(function(s){" +
            "s.setProperty('--frost-inset-top','${next.getDouble("top")}px');" +
            "s.setProperty('--frost-inset-bottom','${next.getDouble("bottom")}px');" +
            "s.setProperty('--frost-inset-left','${next.getDouble("left")}px');" +
            "s.setProperty('--frost-inset-right','${next.getDouble("right")}px');" +
            "s.setProperty('--frost-ime','${next.getDouble("ime")}px');" +
            "})(document.documentElement.style)"
        webView?.evaluateJavascript(css, null)
        trigger("insets", next)
    }

    @Command
    fun getInsets(invoke: Invoke) {
        invoke.resolve(insets)
    }

    @Command
    fun updateSession(invoke: Invoke) {
        val args = invoke.parseArgs(SessionArgs::class.java)
        FrostPlayback.update(
            activity,
            Snapshot(
                title = args.title ?: "",
                artist = args.artist ?: "",
                album = args.album ?: "",
                artwork = args.artwork,
                durationMs = args.duration?.takeIf { it.isFinite() && it > 0 }?.let { (it * 1000).toLong() } ?: -1L,
                positionMs = args.position?.takeIf { it.isFinite() && it >= 0 }?.let { (it * 1000).toLong() } ?: 0L,
                playing = args.playing,
                rate = (args.rate ?: 1.0).toFloat(),
                hasNext = args.hasNext,
                hasPrevious = args.hasPrevious,
            ),
        )
        invoke.resolve()
    }

    @Command
    fun clearSession(invoke: Invoke) {
        FrostPlayback.clear(activity)
        invoke.resolve()
    }

    @Command
    fun setSystemBars(invoke: Invoke) {
        val args = invoke.parseArgs(SystemBarsArgs::class.java)
        activity.runOnUiThread {
            val controller = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
            controller.isAppearanceLightStatusBars = args.light
            controller.isAppearanceLightNavigationBars = args.light
            invoke.resolve()
        }
    }

    /** Корень истории: не закрываем приложение (музыка бы остановилась), а сворачиваем. */
    @Command
    fun minimize(invoke: Invoke) {
        activity.runOnUiThread {
            activity.moveTaskToBack(true)
            invoke.resolve()
        }
    }

    @Command
    fun keepScreenOn(invoke: Invoke) {
        val args = invoke.parseArgs(FlagArgs::class.java)
        activity.runOnUiThread {
            if (args.enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
            invoke.resolve()
        }
    }

    @Command
    fun nativeInfo(invoke: Invoke) {
        val result = JSObject()
        result.put("nativeLibraryDir", activity.applicationInfo.nativeLibraryDir)
        result.put("sdk", Build.VERSION.SDK_INT)
        result.put("release", Build.VERSION.RELEASE)
        result.put("model", Build.MODEL)
        result.put("manufacturer", Build.MANUFACTURER)
        result.put("abi", Build.SUPPORTED_ABIS.firstOrNull() ?: "")
        val version = runCatching {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName
        }.getOrNull()
        result.put("versionName", version ?: "")
        invoke.resolve(result)
    }

    // ---------- Медиатека «На телефоне» ----------

    private fun audioAlias(): String =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "audio" else "storage"

    @Command
    fun requestAudioPermission(invoke: Invoke) {
        val alias = audioAlias()
        if (getPermissionState(alias) == PermissionState.GRANTED) {
            invoke.resolve(JSObject().put("granted", true))
            return
        }
        requestPermissionForAlias(alias, invoke, "audioPermissionResult")
    }

    @PermissionCallback
    fun audioPermissionResult(invoke: Invoke) {
        val granted = getPermissionState(audioAlias()) == PermissionState.GRANTED
        invoke.resolve(JSObject().put("granted", granted))
    }

    /** Системный выбор папки (SAF). Папку на внутренней памяти/SD переводим в обычный путь. */
    @Command
    fun pickFolder(invoke: Invoke) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
        try {
            startActivityForResult(invoke, intent, "folderPicked")
        } catch (e: Exception) {
            invoke.reject("Системный выбор папки недоступен: ${e.message}")
        }
    }

    @ActivityCallback
    fun folderPicked(invoke: Invoke, result: ActivityResult) {
        val uri = result.data?.data
        val response = JSObject()
        if (result.resultCode == Activity.RESULT_OK && uri != null) {
            val path: String? = treeUriToPath(uri)
            response.put("path", path)
            response.put("uri", uri.toString())
        }
        invoke.resolve(response)
    }

    private fun treeUriToPath(uri: Uri): String? {
        if (uri.authority != "com.android.externalstorage.documents") return null
        val documentId = runCatching { DocumentsContract.getTreeDocumentId(uri) }.getOrNull() ?: return null
        val volume = documentId.substringBefore(':')
        val relative = documentId.substringAfter(':', "").trim('/')
        @Suppress("DEPRECATION")
        val base = if (volume.equals("primary", ignoreCase = true)) {
            Environment.getExternalStorageDirectory().absolutePath
        } else {
            "/storage/$volume"
        }
        return if (relative.isEmpty()) base else "$base/$relative"
    }

    // ---------- Ссылки, вибрация, голосовой поиск ----------

    /**
     * Текст ссылки из интента: переход по ссылке (VIEW) или «Поделиться» (SEND, text/plain).
     * Что это за ссылка, разбирает фронтенд (src/lib/shareLinks.ts).
     */
    private fun linkFrom(intent: Intent?): String? {
        if (intent == null) return null
        // Запуск из списка недавних повторяет старый интент: ссылку уже открывали
        if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
        val text = when (intent.action) {
            Intent.ACTION_VIEW -> intent.dataString
            Intent.ACTION_SEND -> intent.getStringExtra(Intent.EXTRA_TEXT)
            else -> null
        }
        return text?.trim()?.takeIf { it.isNotEmpty() }
    }

    /** Frost уже открыт (launchMode singleTask), а пользователь поделился ещё одной ссылкой. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        val link = linkFrom(intent) ?: return
        if (hasListener("link")) {
            val payload = JSObject()
            payload.put("url", link)
            trigger("link", payload)
        } else {
            pendingLink = link
        }
    }

    /** Ссылка, с которой запустили Frost. Отдаётся один раз. */
    @Command
    fun takeLink(invoke: Invoke) {
        val response = JSObject()
        pendingLink?.let { response.put("url", it) }
        pendingLink = null
        invoke.resolve(response)
    }

    /** Короткий отклик вибромотора, как у системных кнопок. Разрешение VIBRATE не нужно. */
    @Command
    fun haptic(invoke: Invoke) {
        val args = invoke.parseArgs(HapticArgs::class.java)
        val constant = when (args.kind) {
            "tick" -> HapticFeedbackConstants.CLOCK_TICK
            "confirm" -> if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY
            else -> HapticFeedbackConstants.LONG_PRESS
        }
        activity.runOnUiThread {
            (webView ?: activity.window.decorView).performHapticFeedback(constant)
        }
        invoke.resolve()
    }

    /**
     * Android 12+: основной цвет системной палитры, которую Android строит из обоев (Material You).
     * На старых версиях пустой ответ.
     */
    @Command
    fun systemAccent(invoke: Invoke) {
        val response = JSObject()
        if (Build.VERSION.SDK_INT >= 31) {
            val color = activity.getColor(android.R.color.system_accent1_500)
            response.put("color", String.format("#%06x", color and 0xffffff))
        }
        invoke.resolve(response)
    }

    /** Голосовой поиск: системное окно распознавания речи. Доступ к микрофону просит оно само. */
    @Command
    fun voiceSearch(invoke: Invoke) {
        val args = invoke.parseArgs(VoiceArgs::class.java)
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
            .putExtra(RecognizerIntent.EXTRA_PROMPT, args.prompt ?: "Что найти?")
        try {
            startActivityForResult(invoke, intent, "voiceRecognized")
        } catch (e: Exception) {
            invoke.reject("На телефоне нет распознавания речи. Обычно его даёт приложение Google")
        }
    }

    @ActivityCallback
    fun voiceRecognized(invoke: Invoke, result: ActivityResult) {
        val response = JSObject()
        val texts = result.data?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
        if (result.resultCode == Activity.RESULT_OK && !texts.isNullOrEmpty()) {
            response.put("text", texts[0])
        }
        invoke.resolve(response)
    }

    // ---------- Обновления и «Поделиться» ----------

    @Command
    fun installApk(invoke: Invoke) {
        val args = invoke.parseArgs(PathArgs::class.java)
        val file = File(args.path)
        if (!file.isFile) {
            invoke.reject("Файл обновления не найден")
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
            runCatching {
                activity.startActivity(
                    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                )
            }
            invoke.reject("Разрешите Frost устанавливать приложения и нажмите «Обновить» ещё раз")
            return
        }
        try {
            val uri = FileProvider.getUriForFile(activity, activity.packageName + ".frost.files", file)
            val intent = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            activity.startActivity(intent)
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Не удалось открыть установщик: ${e.message}")
        }
    }

    // ---------- Сохранение файла через системный диалог ----------

    /** Текст, который ждёт, пока пользователь выберет, куда сохранить файл. */
    private var pendingDocument: String? = null

    /** Системный диалог «Сохранить как» (SAF): резервная копия попадает туда, куда выберет пользователь. */
    @Command
    fun saveDocument(invoke: Invoke) {
        val args = invoke.parseArgs(SaveDocumentArgs::class.java)
        pendingDocument = args.contents
        val intent = Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(args.mime)
            .putExtra(Intent.EXTRA_TITLE, args.name)
        try {
            startActivityForResult(invoke, intent, "documentCreated")
        } catch (e: Exception) {
            pendingDocument = null
            invoke.reject("Системный диалог сохранения недоступен: ${e.message}")
        }
    }

    @ActivityCallback
    fun documentCreated(invoke: Invoke, result: ActivityResult) {
        val contents = pendingDocument
        pendingDocument = null
        val uri = result.data?.data
        val response = JSObject()
        if (result.resultCode != Activity.RESULT_OK || uri == null || contents == null) {
            response.put("saved", false)
            invoke.resolve(response)
            return
        }
        try {
            val stream = activity.contentResolver.openOutputStream(uri, "wt")
                ?: throw IllegalStateException("файл недоступен для записи")
            stream.use { it.write(contents.toByteArray(Charsets.UTF_8)) }
            response.put("saved", true)
            invoke.resolve(response)
        } catch (e: Exception) {
            invoke.reject("Не удалось записать файл: ${e.message}")
        }
    }

    @Command
    fun share(invoke: Invoke) {
        val args = invoke.parseArgs(ShareArgs::class.java)
        val send = Intent(Intent.ACTION_SEND)
            .setType("text/plain")
            .putExtra(Intent.EXTRA_TEXT, args.text)
        args.title?.let { send.putExtra(Intent.EXTRA_SUBJECT, it) }
        try {
            activity.startActivity(Intent.createChooser(send, args.title ?: "Поделиться"))
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Не удалось открыть меню «Поделиться»: ${e.message}")
        }
    }
}
