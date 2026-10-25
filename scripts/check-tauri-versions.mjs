#!/usr/bin/env node
// Проверка, что у пар «крейт Tauri ↔ npm-пакет Tauri» совпадают major.minor:
//
//   tauri               (src-tauri/Cargo.lock)  ↔  @tauri-apps/api       (package-lock.json)
//   tauri-plugin-<имя>  (src-tauri/Cargo.lock)  ↔  @tauri-apps/plugin-<имя> (package-lock.json)
//
// Сборщик Tauri (`tauri build`, `tauri android build`) отказывается собирать, если версии пары
// разъехались, например после того, как Dependabot обновил только одну половину. Этот скрипт
// ловит расхождение за секунды, до долгой сборки. Зависимостей нет, `npm ci` не нужен.
//
//   node scripts/check-tauri-versions.mjs [папка проекта]
//
// Код выхода 1, если хоть одна пара расходится. В GitHub Actions пишет ::error:: и таблицу в
// сводку запуска (GITHUB_STEP_SUMMARY).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Версии npm-пакетов @tauri-apps/* верхнего уровня из package-lock.json (lockfileVersion 2/3). */
export function npmTauriVersions(lockText) {
  const lock = JSON.parse(lockText);
  const out = new Map();
  const packages = lock.packages ?? {};
  for (const [path, info] of Object.entries(packages)) {
    const m = /^node_modules\/(@tauri-apps\/[^/]+)$/.exec(path);
    if (m && info && typeof info.version === 'string') out.set(m[1], info.version);
  }
  // lockfileVersion 1: только раздел dependencies
  for (const [name, info] of Object.entries(lock.dependencies ?? {})) {
    if (name.startsWith('@tauri-apps/') && !out.has(name) && typeof info?.version === 'string') out.set(name, info.version);
  }
  return out;
}

/** Версии крейтов tauri и tauri-plugin-* из Cargo.lock. У одного крейта их может быть несколько. */
export function cargoTauriVersions(lockText) {
  const out = new Map();
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const name = /^name\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    const version = /^version\s*=\s*"([^"]+)"/m.exec(block)?.[1];
    if (!name || !version) continue;
    if (name !== 'tauri' && !name.startsWith('tauri-plugin-')) continue;
    const list = out.get(name) ?? [];
    if (!list.includes(version)) list.push(version);
    out.set(name, list);
  }
  return out;
}

/** Имя крейта для npm-пакета Tauri или null, если у пакета нет пары на стороне Rust. */
export function crateFor(npmName) {
  if (npmName === '@tauri-apps/api') return 'tauri';
  const m = /^@tauri-apps\/plugin-(.+)$/.exec(npmName);
  return m ? `tauri-plugin-${m[1]}` : null;
}

const majorMinor = (v) => {
  const m = /^(\d+)\.(\d+)/.exec(v);
  return m ? `${m[1]}.${m[2]}` : v;
};

/**
 * Сравнивает пары. `ok: false`, если major.minor разошлись или крейта нет в Cargo.lock
 * (плагин подключён только в package.json, сборка тоже упадёт).
 */
export function comparePairs(npm, cargo) {
  const rows = [];
  for (const [pkg, npmVersion] of [...npm.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const crate = crateFor(pkg);
    if (!crate) continue;
    const crateVersions = cargo.get(crate) ?? [];
    const ok = crateVersions.length > 0 && crateVersions.every((v) => majorMinor(v) === majorMinor(npmVersion));
    rows.push({ crate, crateVersions, pkg, npmVersion, ok });
  }
  return rows;
}

function hint(row) {
  if (!row.crateVersions.length) return `крейта ${row.crate} нет в Cargo.lock: добавьте его в src-tauri/Cargo.toml или уберите ${row.pkg} из package.json`;
  const crate = row.crateVersions.join(', ');
  const want = majorMinor(row.npmVersion);
  const have = majorMinor(row.crateVersions[0]);
  return want.localeCompare(have, undefined, { numeric: true }) > 0
    ? `обновите крейт: cd src-tauri && cargo update -p ${row.crate} (сейчас ${crate}, нужно ${want}.x)`
    : `обновите npm-пакет: npm install ${row.pkg}@~${have}.0 (сейчас ${row.npmVersion}, крейт ${crate})`;
}

export function check(dir) {
  const npmLock = join(dir, 'package-lock.json');
  const cargoLock = join(dir, 'src-tauri', 'Cargo.lock');
  for (const f of [npmLock, cargoLock]) {
    if (!existsSync(f)) throw new Error(`нет файла ${f}`);
  }
  return comparePairs(npmTauriVersions(readFileSync(npmLock, 'utf8')), cargoTauriVersions(readFileSync(cargoLock, 'utf8')));
}

function main() {
  const dir = resolve(process.argv[2] ?? '.');
  const gha = !!process.env.GITHUB_ACTIONS;
  let rows;
  try {
    rows = check(dir);
  } catch (e) {
    console.error(`${gha ? '::error::' : ''}Проверка версий Tauri: ${e.message}`);
    process.exit(1);
  }
  const bad = rows.filter((r) => !r.ok);
  const pad = (s, n) => s + ' '.repeat(Math.max(1, n - s.length));
  console.log('Пары крейт ↔ npm-пакет Tauri (должны совпадать major.minor):');
  for (const r of rows) {
    console.log(`  ${r.ok ? 'ok    ' : 'ОШИБКА'} ${pad(`${r.crate} ${r.crateVersions.join(', ') || '—'}`, 40)} ${r.pkg} ${r.npmVersion}`);
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = ['### Версии Tauri: Rust ↔ npm', '', '| крейт | npm-пакет | |', '|---|---|---|'];
    for (const r of rows) lines.push(`| ${r.crate} ${r.crateVersions.join(', ') || '—'} | ${r.pkg} ${r.npmVersion} | ${r.ok ? '✅' : '❌'} |`);
    if (bad.length) lines.push('', 'Сборщик Tauri не соберёт приложение, пока major.minor в паре не совпадут.');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n\n');
  }
  if (!bad.length) {
    console.log(`Все ${rows.length} пар совпадают.`);
    return;
  }
  for (const r of bad) {
    const msg = `${r.crate} ${r.crateVersions.join(', ') || '(нет)'} и ${r.pkg} ${r.npmVersion} разошлись: ${hint(r)}`;
    console.error(gha ? `::error title=Версии Tauri::${msg}` : `ОШИБКА: ${msg}`);
  }
  console.error('Обновляйте плагины Tauri парами: крейт в src-tauri/Cargo.toml и пакет в package.json вместе.');
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
