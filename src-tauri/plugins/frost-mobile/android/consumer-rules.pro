# Плагин загружается из Rust через JNI, команды и колбэки Tauri ищет рефлексией по имени
# (@Command, @ActivityCallback, @PermissionCallback, @InvokeArg). R8 не должен их трогать.
-keep class app.frost.mobile.** { *; }
