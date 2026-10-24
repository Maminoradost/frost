//! Платформенные мелочи, которые не относятся к конкретному модулю.

use std::path::PathBuf;

/// Папка нативных библиотек APK (`ApplicationInfo.nativeLibraryDir`).
///
/// Ищем её по карте памяти процесса: там лежит наша же `libfrost_lib.so`. Папка существует
/// только когда библиотеки распаковываются при установке (`useLegacyPackaging = true`
/// в `app/build.gradle.kts`, это делает `scripts/android-setup.mjs`).
#[cfg(target_os = "android")]
pub fn native_lib_dir() -> Option<PathBuf> {
    use std::sync::OnceLock;
    static DIR: OnceLock<Option<PathBuf>> = OnceLock::new();
    DIR.get_or_init(|| {
        let maps = std::fs::read_to_string("/proc/self/maps").ok()?;
        maps.lines()
            .filter_map(|line| line.split_whitespace().nth(5))
            .find(|path| path.ends_with("/libfrost_lib.so"))
            .and_then(|path| std::path::Path::new(path).parent().map(|p| p.to_path_buf()))
    })
    .clone()
}

/// `rustypipe-botguard`, вложенный в APK как `librustypipe_botguard.so`.
///
/// Android 10+ не даёт запускать скачанные программы из папки данных, но разрешает
/// запуск из папки нативных библиотек, поэтому бинарник едет внутри APK (см. android.yml).
#[cfg(target_os = "android")]
pub fn bundled_botguard() -> Option<PathBuf> {
    native_lib_dir()
        .map(|dir| dir.join("librustypipe_botguard.so"))
        .filter(|path| path.is_file())
}

#[cfg(not(target_os = "android"))]
pub fn bundled_botguard() -> Option<PathBuf> {
    None
}

/// На Android нет yt-dlp, Deno и установщиков: эти команды отвечают понятной ошибкой.
#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub const ANDROID_UNSUPPORTED: &str = "На Android эта функция недоступна: YouTube работает через встроенный RustyPipe";
