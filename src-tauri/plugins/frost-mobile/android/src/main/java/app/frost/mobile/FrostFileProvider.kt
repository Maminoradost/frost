package app.frost.mobile

import androidx.core.content.FileProvider

/**
 * Свой подкласс, чтобы не конфликтовать в манифесте с FileProvider других плагинов.
 * Отдаёт системному установщику скачанные обновления (см. installApk).
 */
class FrostFileProvider : FileProvider()
