#!/usr/bin/env node
// Build cascx.exe (our read-only CascLib wrapper) from source.
//
//   node tools/datamine/build-cascx.mjs [--sidecar] [--casclib <dir>]
//
// It fetches CascLib at the pinned commit in CASCLIB_COMMIT below (MIT, licence kept in the clone),
// then compiles tools/datamine/cascx/cascx.cpp against it. MSVC (cl.exe) is used when it is on PATH
// or findable with vswhere, otherwise mingw-w64 gcc/g++.
//
// Output: tools/datamine/bin/cascx.exe, and with --sidecar also
// src-tauri/bin/cascx-x86_64-pc-windows-msvc.exe, where Tauri picks up external binaries.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');

export const CASCLIB_REPO = 'https://github.com/ladislav-zezula/CascLib.git';
/** Pinned so a CI build is reproducible. Bump deliberately, and re-test the extractor afterwards. */
export const CASCLIB_COMMIT = '38a34665624b8775bb875274b36191b21c38d97b';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const CASCLIB = path.resolve(opt('--casclib', path.join(ROOT, 'tools', 'vendor', 'CascLib')));
const BIN = path.join(HERE, 'bin', 'cascx.exe');
const SIDECAR = path.join(ROOT, 'src-tauri', 'bin', 'cascx-x86_64-pc-windows-msvc.exe');
const OBJ = path.join(HERE, 'cascx', 'obj');

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
const log = (...a) => console.log('[cascx]', ...a);

/** The C sources CascLib needs beside its C++ ones (zlib and the Jenkins hash). */
const C_FILES = ['zlib/adler32.c', 'zlib/crc32.c', 'zlib/deflate.c', 'zlib/trees.c', 'zlib/zutil.c',
  'zlib/inffast.c', 'zlib/inflate.c', 'zlib/inftrees.c', 'jenkins/lookup3.c'];

function fetchCascLib() {
  if (fs.existsSync(path.join(CASCLIB, 'src', 'CascLib.h'))) {
    log('CascLib already at', CASCLIB);
    return;
  }
  log('fetching CascLib', CASCLIB_COMMIT.slice(0, 10), 'into', CASCLIB);
  fs.mkdirSync(CASCLIB, { recursive: true });
  run('git', ['init', '-q'], { cwd: CASCLIB });
  run('git', ['remote', 'add', 'origin', CASCLIB_REPO], { cwd: CASCLIB });
  try {
    run('git', ['fetch', '-q', '--depth', '1', 'origin', CASCLIB_COMMIT], { cwd: CASCLIB });
  } catch {
    // some servers refuse a fetch by sha: take the branch and check the commit out of it
    log('fetch by commit refused, fetching master instead');
    run('git', ['fetch', '-q', 'origin', 'master'], { cwd: CASCLIB });
  }
  run('git', ['checkout', '-q', CASCLIB_COMMIT], { cwd: CASCLIB });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CASCLIB, encoding: 'utf8' }).trim();
  if (head !== CASCLIB_COMMIT) throw new Error(`CascLib is at ${head}, not the pinned ${CASCLIB_COMMIT}`);
}

/** cl.exe, from PATH or from the newest Visual Studio with the C++ tools. */
function findMsvc() {
  try {
    execFileSync('cl', ['/?'], { stdio: 'ignore' });
    return { cl: 'cl', env: process.env };
  } catch {
    /* not on PATH: look for a Visual Studio */
  }
  const vswhere = path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  if (!fs.existsSync(vswhere)) return null;
  let install;
  try {
    install = execFileSync(vswhere, ['-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
  if (!install) return null;
  const vcvars = path.join(install, 'VC', 'Auxiliary', 'Build', 'vcvars64.bat');
  if (!fs.existsSync(vcvars)) return null;
  // read the environment vcvars64 sets up, so cl.exe and its headers resolve
  const dump = execSync(`"${vcvars}" >nul && set`, { encoding: 'utf8', maxBuffer: 1 << 24, shell: process.env.COMSPEC || 'cmd.exe' });
  const env = { ...process.env };
  for (const line of dump.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) env[line.slice(0, i)] = line.slice(i + 1);
  }
  return { cl: 'cl', env };
}

function buildMsvc({ cl, env }) {
  log('building with MSVC');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cascx-'));
  run(
    cl,
    [
      '/nologo', '/O2', '/MT', '/EHsc', '/W0', '/std:c++17',
      '/DUNICODE', '/D_UNICODE', '/D_CRT_SECURE_NO_WARNINGS', '/D_WINSOCK_DEPRECATED_NO_WARNINGS',
      '/I' + CASCLIB, '/I' + path.join(CASCLIB, 'src'),
      '/Fo' + tmp + path.sep,
      path.join(HERE, 'cascx', 'cascx.cpp'),
      ...C_FILES.map((c) => path.join(CASCLIB, 'src', c)),
      '/Fe:' + BIN,
      '/link', 'ws2_32.lib', 'wininet.lib', 'advapi32.lib', 'user32.lib',
    ],
    { env, cwd: tmp },
  );
  fs.rmSync(tmp, { recursive: true, force: true });
}

function buildMingw() {
  log('building with mingw-w64');
  fs.mkdirSync(OBJ, { recursive: true });
  const objs = [];
  for (const c of C_FILES) {
    const o = path.join(OBJ, path.basename(c, '.c') + '.o');
    run('gcc', ['-O2', '-c', '-DUNICODE', '-D_UNICODE', path.join(CASCLIB, 'src', c), '-o', o]);
    objs.push(o);
  }
  run('g++', ['-O2', '-std=c++17', '-DUNICODE', '-D_UNICODE', '-D_CRT_SECURE_NO_WARNINGS', '-I' + CASCLIB,
    '-I' + path.join(CASCLIB, 'src'), '-w', path.join(HERE, 'cascx', 'cascx.cpp'), ...objs, '-o', BIN, '-static',
    '-lws2_32', '-lwininet']);
}

function main() {
  fetchCascLib();
  fs.mkdirSync(path.dirname(BIN), { recursive: true });
  const msvc = findMsvc();
  if (msvc) buildMsvc(msvc);
  else buildMingw();
  log('built', BIN, fs.statSync(BIN).size, 'bytes');
  // a quick self-check that does not need the game: the usage message
  try {
    execFileSync(BIN, [], { stdio: 'pipe' });
  } catch (e) {
    if (e.status !== 2) throw new Error('cascx.exe did not start: ' + e.message);
  }
  if (argv.includes('--sidecar')) {
    fs.mkdirSync(path.dirname(SIDECAR), { recursive: true });
    fs.copyFileSync(BIN, SIDECAR);
    log('sidecar', SIDECAR);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) main();
