//! Нативная часть Frost для Android.
//!
//! Команды из фронтенда (`invoke('plugin:frost-mobile|update_session', …)`) Tauri сам
//! передаёт Kotlin-классу `app.frost.mobile.FrostMobilePlugin`. Rust-часть регистрирует
//! этот класс и даёт ядру вызовы, которые нужны из Rust (установка скачанного APK).
//! На десктопе плагин подключён, но ничего не делает: так права (ACL) едины для всех платформ.

use std::marker::PhantomData;
use std::path::Path;

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime};

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "app.frost.mobile";

/// Доступ к нативной части из Rust: `app.frost_mobile()`.
pub struct FrostMobile<R: Runtime> {
    #[cfg(target_os = "android")]
    handle: tauri::plugin::PluginHandle<R>,
    _runtime: PhantomData<fn() -> R>,
}

#[cfg(target_os = "android")]
impl<R: Runtime> FrostMobile<R> {
    /// Отдаёт скачанный APK системному установщику Android.
    pub fn install_apk(&self, path: &Path) -> Result<(), String> {
        self.handle
            .run_mobile_plugin::<serde_json::Value>(
                "installApk",
                serde_json::json!({ "path": path.to_string_lossy() }),
            )
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(target_os = "android"))]
impl<R: Runtime> FrostMobile<R> {
    /// На десктопе APK не устанавливаются.
    pub fn install_apk(&self, _path: &Path) -> Result<(), String> {
        Err("Установка APK возможна только на Android".into())
    }
}

pub trait FrostMobileExt<R: Runtime> {
    fn frost_mobile(&self) -> &FrostMobile<R>;
}

impl<R: Runtime, T: Manager<R>> FrostMobileExt<R> for T {
    fn frost_mobile(&self) -> &FrostMobile<R> {
        self.state::<FrostMobile<R>>().inner()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("frost-mobile")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            let handle = api.register_android_plugin(PLUGIN_IDENTIFIER, "FrostMobilePlugin")?;
            #[cfg(not(target_os = "android"))]
            let _ = api;
            app.manage(FrostMobile::<R> {
                #[cfg(target_os = "android")]
                handle,
                _runtime: PhantomData,
            });
            Ok(())
        })
        .build()
}
