# Frost для Android

Тот же Frost, что и на Windows (Tauri 2, тот же код плеера и источников), но с интерфейсом для телефона.

- Android 8.0 и новее (API 26+).
- Один APK для arm64-v8a и armeabi-v7a, то есть почти для всех телефонов.

## Установка

1. Скачайте `Frost_<версия>_android.apk` со страницы [Releases](https://github.com/Susanoooooooo/Frost/releases).
2. Откройте файл на телефоне. Android попросит разрешить установку из этого источника (браузера или файлового менеджера): разрешите и вернитесь к установке.
3. При первом запуске Frost спросит разрешение на уведомления (для управления музыкой) и доступ к аудиофайлам (для своей музыки).

**Обновления.** Настройки → «Дополнительно» → проверка обновлений. Frost скачает новый APK, а Android предложит установить его поверх. Музыка, плейлисты и настройки сохраняются.

Поверх ставится только APK, подписанный тем же ключом. Если ключ другой (например, тестовая сборка `*-debugsigned.apk` из Actions), Android откажется обновлять. Тогда сделайте резервную копию (Настройки → «Дополнительно»), удалите Frost и установите заново.

## Чем отличается от Windows

- **Интерфейс для телефона:** нижняя панель разделов, мини-плеер, полноэкранный плеер со свайпами, кнопка «Назад».
- **Фоновое воспроизведение:** уведомление с кнопками, управление с экрана блокировки, гарнитуры и часов.
- **Своя музыка:** папка выбирается системным диалогом. Обложки и теги читаются так же, как на компьютере.
- **YouTube:** только встроенный движок RustyPipe, yt-dlp на Android не запускается.
  - Помощник PO-токенов (rustypipe-botguard) в APK не входит: для его движка V8 нет готовой сборки под Android.
  - Без него YouTube иногда может отказывать в отдельных треках. Обычно помогает повтор.
- **Резервная копия** сохраняется через системный диалог «Сохранить как».
- **Жесты:** долгое нажатие на трек открывает его меню, свайп по мини-плееру меняет трек. Оба с лёгким виброоткликом (учитывается системная настройка «Виброотклик»).
- **Цвета из обоев** (Android 12+): «Настройки → Оформление → Цвета из обоев». Палитра Frost строится из системного цвета Material You и обновляется, когда вы меняете обои.
- **Голосовой поиск:** кнопка микрофона в поле поиска. Распознаёт системное окно Android, обычно это приложение Google. Если его нет, Frost так и скажет.
- **Ссылки:** Frost есть в меню «Поделиться» для ссылок YouTube, YouTube Music и SoundCloud. Трек сразу играет, плейлист или исполнитель открываются страницей.
  - Чтобы такие ссылки открывались во Frost и по нажатию (не только через «Поделиться»), на Android 12 и новее включите их один раз: «Настройки → Приложения → Frost → Открывать по умолчанию → Добавить ссылку». Без этого система отдаёт чужие домены браузеру.
- **Нет на Android:** Discord, выбор устройства вывода, эффекты фона окна, значок в трее, глобальные горячие клавиши, отдельное окно мини-плеера, автозапуск.

## Сборка в GitHub Actions

Процесс **Android** (`.github/workflows/android.yml`) собирает APK на серверах GitHub.

- **Вручную:** вкладка Actions → Android → Run workflow. Готовый APK лежит в артефактах запуска (`frost-android-<версия>`).
- **С релизом:** тег `v*` запускает `release.yml`. Он вызывает тот же процесс и прикрепляет подписанный APK к черновику релиза рядом с установщиком Windows.

Первая сборка идёт долго, 40-60 минут: Rust собирается с LTO под две архитектуры. Следующие быстрее за счёт кэша.

### Ключ подписи (один раз)

Без ключа Actions подписывает APK временным ключом. Такой файл называется `*-debugsigned.apk`, годится для проверки и в релиз не попадает. Каждый запуск создаёт новый временный ключ, поэтому такие сборки не обновляются друг поверх друга.

1. Создайте ключ (`keytool` входит в JDK). Он спросит пароль и имя:

   ```
   keytool -genkeypair -v -keystore frost-release.jks -keyalg RSA -keysize 2048 -validity 10000 -alias frost
   ```

2. Переведите файл в base64:
   - Linux и macOS: `base64 -w0 frost-release.jks > frost-release.b64` (на macOS просто `base64 -i frost-release.jks`)
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("frost-release.jks")) | Set-Content frost-release.b64`

3. В репозитории: Settings → Secrets and variables → Actions → New repository secret. Добавьте четыре секрета:

   | Секрет | Что вписать |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | содержимое `frost-release.b64` |
   | `ANDROID_KEYSTORE_PASSWORD` | пароль хранилища ключей |
   | `ANDROID_KEY_ALIAS` | имя ключа (`frost` в примере выше) |
   | `ANDROID_KEY_PASSWORD` | пароль ключа (если не задавали отдельно, тот же пароль) |

4. Запустите Actions → Android ещё раз. Теперь в артефактах будет `Frost_<версия>_android.apk`.
5. Откройте сводку этого запуска (страница запуска в Actions, блок «APK для Android»). Скопируйте «SHA-256 сертификата» и сохраните его в Settings → Secrets and variables → Actions → **Variables** → New repository variable с именем `ANDROID_CERT_SHA256`. С этого момента каждая подписанная сборка сверяет свой сертификат с ним и падает, если ключ подменили или перепутали. Такой APK всё равно не встал бы поверх установленного Frost.

**Храните `frost-release.jks` и пароли надёжно и не кладите их в репозиторий.** Если ключ потеряется, новые версии не встанут поверх уже установленных: пользователям придётся удалить Frost и поставить заново.

## Локальная сборка

Понадобятся:
- Node.js LTS;
- Rust stable;
- JDK 17 или новее (лучше 21);
- Android SDK и NDK r28 или новее (через Android Studio → SDK Manager);
- libclang: на Linux пакет `libclang-dev`, на Windows и macOS LLVM.

Переменные окружения: `ANDROID_HOME` (путь к SDK), `NDK_HOME` (путь к NDK, например `$ANDROID_HOME/ndk/28.2.13676358`) и, если libclang не находится сам, `LIBCLANG_PATH`.

QuickJS (движок для RustyPipe) собирает привязки к C через bindgen, и ему нужны заголовки Android из NDK. Укажите их для обеих архитектур. Вместо `linux-x86_64` подставьте `windows-x86_64` на Windows или `darwin-x86_64` на macOS:

```
export BINDGEN_EXTRA_CLANG_ARGS_aarch64_linux_android="--sysroot=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot"
export BINDGEN_EXTRA_CLANG_ARGS_armv7_linux_androideabi="--sysroot=$NDK_HOME/toolchains/llvm/prebuilt/linux-x86_64/sysroot"
```

Сборка:

```
npm ci
npm run tauri -- android init
node scripts/android-setup.mjs
npm run tauri -- android build --apk --target aarch64 armv7
```

Проект Gradle появляется в `src-tauri/gen/android`. Он не хранится в репозитории: после каждого `android init` снова запускайте `scripts/android-setup.mjs`. Повторный запуск ничего не дублирует.

Для отладки на подключённом телефоне: `npm run tauri -- android dev`.

**Подпись при локальной сборке.** Создайте `src-tauri/gen/android/keystore.properties`, и Gradle сразу соберёт подписанный `app-universal-release.apk`. Файл уже исключён из git. В Windows пишите путь через `/` или удваивайте `\`:

```
storeFile=/полный/путь/frost-release.jks
storePassword=пароль хранилища
keyAlias=frost
keyPassword=пароль ключа
```

**Свой rustypipe-botguard.** Если у вас есть исполняемый файл rustypipe-botguard, собранный под Android, укажите его перед `android-setup.mjs`. Скрипт положит его в APK как `librustypipe_botguard.so`, и Frost найдёт его сам:

```
FROST_BOTGUARD_BIN=/путь/к/rustypipe-botguard node scripts/android-setup.mjs
```

ABI задаёт `FROST_BOTGUARD_ABI`, по умолчанию `arm64-v8a`.

## Как устроено

| Где | Что |
| --- | --- |
| `src/mobile/`, `src/styles/mobile.css` | интерфейс для телефона |
| `src/lib/android.ts`, `src/lib/platform.ts` | обращения к плагину Android и различия платформ |
| `src-tauri/plugins/frost-mobile/` | плагин Tauri на Kotlin: медиасессия и уведомление, фоновая служба, разрешения, выбор папки, сохранение файлов, установка APK, системные панели и отступы под вырезы |
| `src-tauri/src/loopback.rs` | локальный сервер на 127.0.0.1: отдаёт звук плееру WebView с перемоткой (Range). WebView на Android не умеет потоково читать звук из протоколов Tauri |
| `src-tauri/src/platform.rs` | пути и встроенный rustypipe-botguard на Android |
| `src-tauri/tauri.android.conf.json`, `src-tauri/capabilities/android.json` | настройки окна и разрешения команд на Android |
| `scripts/android-setup.mjs` | донастройка проекта Gradle: подпись, упаковка библиотек, фон окна, значки |
| `src-tauri/icons/android/` | исходники адаптивного значка (`icon.json` для `tauri icon`) |

## Если сборка упала

- **`Unable to find libclang`**: поставьте libclang или LLVM и укажите `LIBCLANG_PATH` (папку с `libclang.so` или `libclang.dll`).
- **`'stdlib.h' file not found` в rquickjs-sys**: не заданы `BINDGEN_EXTRA_CLANG_ARGS_*` с `--sysroot` из NDK (см. «Локальная сборка»).
- **`Android-проекта ещё нет`** из `android-setup.mjs`: сначала `npm run tauri -- android init`.
- **`не нашёл, куда вставить настройки`**: изменился шаблон Tauri. Скрипт рассчитан на `@tauri-apps/cli` из `package-lock.json`.
- **В Actions «Нет подписанного APK»**: проверьте четыре секрета подписи, особенно `ANDROID_KEYSTORE_BASE64` (одна строка без переносов).
- **«APK подписан другим сертификатом»**: секрет `ANDROID_KEYSTORE_BASE64` содержит не тот ключ, которым подписаны прошлые версии, или устарела переменная `ANDROID_CERT_SHA256`. Верните прежний ключ; переменную меняйте, только если ключ сменили сознательно.
- **«Версии Tauri: … разошлись»** (шаг «Версии Tauri (Rust ↔ npm)»): у крейта `tauri-plugin-<имя>` и пакета `@tauri-apps/plugin-<имя>` (или `tauri` и `@tauri-apps/api`) разные major.minor, и сборщик Tauri откажется собирать. В сообщении есть команда, которая это исправит. Проверить у себя: `node scripts/check-tauri-versions.mjs`.
