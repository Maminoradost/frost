#!/usr/bin/env node
// Донастройка Android-проекта, который создаёт `npm run tauri android init`
// (папка src-tauri/gen/android). Запускать после init и перед сборкой:
//
//   node scripts/android-setup.mjs
//
// Что делает (повторный запуск ничего не дублирует):
//   1. Подпись релиза ключом из src-tauri/gen/android/keystore.properties, если файл есть.
//      Без файла Gradle соберёт неподписанный APK (app-universal-release-unsigned.apk).
//   2. Упаковка нативных библиотек «по-старому» (useLegacyPackaging): система распаковывает их
//      в nativeLibraryDir при установке. Так Frost находит встроенный rustypipe-botguard.
//   3. Фон окна до загрузки интерфейса: тёмный или светлый по теме системы, без белой вспышки.
//   4. Больше памяти Gradle для R8.
//   5. Значки Frost: адаптивные (фон, передний план, монохромный слой для тематических значков)
//      из src-tauri/icons/android/icon.json через `tauri icon`.
//   6. По желанию: готовый rustypipe-botguard под Android из переменной FROST_BOTGUARD_BIN
//      (ABI задаёт FROST_BOTGUARD_ABI, по умолчанию arm64-v8a).
//
// Флаги: --no-icons пропускает шаг 5.

import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'src-tauri');
const androidDir = join(tauriDir, 'gen', 'android');
const appDir = join(androidDir, 'app');
const resDir = join(appDir, 'src', 'main', 'res');
const args = new Set(process.argv.slice(2));

/** Метка наших вставок: по ней повторный запуск понимает, что файл уже настроен. */
const MARK = 'frost-android-setup';
const done = [];

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

function rel(path) {
  return relative(root, path).replaceAll('\\', '/');
}

/** Читает файл, отдаёт его в `edit` и сохраняет, если появилась наша метка. */
function patch(path, label, edit) {
  if (!existsSync(path)) fail(`Нет файла ${rel(path)}. Пересоздайте проект: npm run tauri android init`);
  const before = readFileSync(path, 'utf8');
  if (before.includes(MARK)) {
    done.push(`${label}: уже настроено`);
    return;
  }
  const eol = before.includes('\r\n') ? '\r\n' : '\n';
  const after = edit(before.replaceAll('\r\n', '\n'));
  if (after == null || !after.includes(MARK)) {
    fail(`${label}: не нашёл, куда вставить настройки в ${rel(path)}. Шаблон Tauri изменился, нужна ручная правка.`);
  }
  writeFileSync(path, eol === '\n' ? after : after.replaceAll('\n', eol));
  done.push(`${label}: готово`);
}

if (!existsSync(join(androidDir, 'settings.gradle')) && !existsSync(join(androidDir, 'settings.gradle.kts'))) {
  fail('Android-проекта ещё нет. Сначала выполните: npm run tauri android init');
}

// 1–2. app/build.gradle.kts: подпись и упаковка библиотек -----------------------------------
patch(join(appDir, 'build.gradle.kts'), 'Подпись и упаковка библиотек', (text) => {
  const block = `android {
    // ${MARK}: подпись релиза ключом из keystore.properties (см. docs/ANDROID.md)
    val frostKeystore = rootProject.file("keystore.properties")
    if (frostKeystore.exists()) {
        val frostSigning = Properties().apply { frostKeystore.inputStream().use { load(it) } }
        signingConfigs {
            create("frostRelease") {
                storeFile = file(frostSigning.getProperty("storeFile"))
                storePassword = frostSigning.getProperty("storePassword")
                keyAlias = frostSigning.getProperty("keyAlias")
                keyPassword = frostSigning.getProperty("keyPassword") ?: frostSigning.getProperty("storePassword")
            }
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("frostRelease")
    }
    // ${MARK}: библиотеки распаковываются при установке, так встроенный botguard можно запустить
    packaging {
        jniLibs.useLegacyPackaging = true
    }
`;
  const anchor = /^android \{\n/m;
  if (!anchor.test(text)) return null;
  let out = text.replace(anchor, block);
  if (!/^import java\.util\.Properties$/m.test(out)) out = `import java.util.Properties\n${out}`;
  return out;
});

// 3. Фон окна до загрузки интерфейса -----------------------------------------------------------
const windowColors = { values: '#FEF7FF', 'values-night': '#141218' };
for (const [folder, color] of Object.entries(windowColors)) {
  mkdirSync(join(resDir, folder), { recursive: true });
  writeFileSync(
    join(resDir, folder, 'frost_colors.xml'),
    `<?xml version="1.0" encoding="utf-8"?>
<!-- ${MARK}: фон окна Frost, пока грузится интерфейс (как в index.html) -->
<resources>
    <color name="frost_window_background">${color}</color>
</resources>
`,
  );
  patch(join(resDir, folder, 'themes.xml'), `Фон окна (${folder})`, (text) => {
    const anchor = /(<style name="Theme\.[^"]*"[^>]*>)([\s\S]*?)(\n\s*<\/style>)/;
    if (!anchor.test(text)) return null;
    return text.replace(
      anchor,
      (_, open, body, close) =>
        `${open}${body}
        <!-- ${MARK}: фон до загрузки интерфейса -->
        <item name="android:windowBackground">@color/frost_window_background</item>${close}`,
    );
  });
}

// 4. Память Gradle --------------------------------------------------------------------------------
patch(join(androidDir, 'gradle.properties'), 'Память Gradle', (text) => {
  const line = `# ${MARK}: R8 и Kotlin просят больше памяти, чем 2 ГБ по умолчанию
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8`;
  if (/^org\.gradle\.jvmargs=.*$/m.test(text)) return text.replace(/^org\.gradle\.jvmargs=.*$/m, line);
  return `${text.trimEnd()}\n${line}\n`;
});

// 5. Значки ------------------------------------------------------------------------------------------
if (args.has('--no-icons')) {
  done.push('Значки: пропущено (--no-icons)');
} else {
  const manifest = join(tauriDir, 'icons', 'android', 'icon.json');
  const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!existsSync(manifest)) fail(`Нет ${rel(manifest)}`);
  if (!existsSync(cli)) fail('Нет @tauri-apps/cli в node_modules. Сначала выполните: npm ci');
  // Во временную папку, иначе `tauri icon` перезапишет значки Windows в src-tauri/icons.
  const tmp = mkdtempSync(join(tmpdir(), 'frost-icons-'));
  try {
    const out = join(tmp, 'icons');
    execFileSync(process.execPath, [cli, 'icon', manifest, '--output', out], { cwd: root, stdio: 'inherit' });
    const generated = join(out, 'android');
    if (!existsSync(join(generated, 'mipmap-anydpi-v26', 'ic_launcher.xml'))) {
      fail('tauri icon не создал значки Android');
    }
    cpSync(generated, resDir, { recursive: true });
    done.push('Значки: готово');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 6. rustypipe-botguard (по желанию) ---------------------------------------------------------------
const botguard = process.env.FROST_BOTGUARD_BIN;
if (botguard) {
  if (!existsSync(botguard)) fail(`FROST_BOTGUARD_BIN указывает на несуществующий файл: ${botguard}`);
  const abi = process.env.FROST_BOTGUARD_ABI || 'arm64-v8a';
  const dest = join(appDir, 'src', 'main', 'jniLibs', abi);
  mkdirSync(dest, { recursive: true });
  // Имя lib*.so: только такие файлы система распаковывает в nativeLibraryDir (см. src-tauri/src/platform.rs).
  copyFileSync(botguard, join(dest, 'librustypipe_botguard.so'));
  chmodSync(join(dest, 'librustypipe_botguard.so'), 0o755);
  done.push(`rustypipe-botguard: встроен (${abi})`);
} else {
  done.push('rustypipe-botguard: не задан FROST_BOTGUARD_BIN, сборка без него');
}

// 7. Ссылки YouTube Music и SoundCloud, «Поделиться» -----------------------------------------------
// Frost появляется в меню «Поделиться» для текста со ссылкой и в списке приложений для ссылок
// music.youtube.com, youtu.be и SoundCloud. Сами ссылки разбирает фронтенд (src/lib/shareLinks.ts,
// src/mobile/useIncomingLinks.ts). На Android 12+ чужие домены по умолчанию открывает браузер:
// включите их в настройках Frost («Открывать по умолчанию» → «Добавить ссылку»).
patch(join(appDir, 'src', 'main', 'AndroidManifest.xml'), 'Ссылки и «Поделиться»', (text) => {
  const anchor = /(<activity\b[^>]*android:name="[^"]*MainActivity"[\s\S]*?)(\n(\s*)<\/activity>)/;
  if (!anchor.test(text)) return null;
  return text.replace(anchor, (_, body, close, indent) => {
    const i = `${indent}    `;
    const filter = (lines) =>
      `\n${i}<intent-filter>\n${lines.map((l) => `${i}    ${l}`).join('\n')}\n${i}</intent-filter>`;
    const view = ['<action android:name="android.intent.action.VIEW" />', '<category android:name="android.intent.category.DEFAULT" />', '<category android:name="android.intent.category.BROWSABLE" />', '<data android:scheme="https" />'];
    return `${body}
${i}<!-- ${MARK}: ссылки YouTube Music и SoundCloud открываются во Frost -->${filter([
      ...view,
      '<data android:host="music.youtube.com" />',
      '<data android:host="youtu.be" />',
      '<data android:host="soundcloud.com" />',
      '<data android:host="m.soundcloud.com" />',
      '<data android:host="on.soundcloud.com" />',
    ])}
${i}<!-- ${MARK}: ролики YouTube только со страниц /watch и /playlist -->${filter([
      ...view,
      '<data android:host="www.youtube.com" />',
      '<data android:host="m.youtube.com" />',
      '<data android:pathPrefix="/watch" />',
      '<data android:pathPrefix="/playlist" />',
    ])}
${i}<!-- ${MARK}: «Поделиться» → Frost (текст со ссылкой) -->${filter([
      '<action android:name="android.intent.action.SEND" />',
      '<category android:name="android.intent.category.DEFAULT" />',
      '<data android:mimeType="text/plain" />',
    ])}${close}`;
  });
});

console.log(`\nAndroid-проект Frost настроен (${rel(androidDir)}):`);
for (const line of done) console.log(`  • ${line}`);
