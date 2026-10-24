// Команды, которые фронтенд вызывает как `plugin:frost-mobile|<команда>`.
// Tauri сам передаёт их в Kotlin (`snake_case` → `camelCase`), но сначала проверяет права,
// поэтому каждая команда должна быть в этом списке и в `permissions/default.toml`.
const COMMANDS: &[&str] = &[
    "update_session",
    "clear_session",
    "get_insets",
    "set_system_bars",
    "minimize",
    "keep_screen_on",
    "native_info",
    "pick_folder",
    "request_audio_permission",
    "install_apk",
    "share",
    "save_document",
    "register_listener",
    "remove_listener",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
