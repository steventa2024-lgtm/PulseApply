/**
 * Makes sure Electron's binary is installed.
 *
 * Newer npm versions can skip dependency install scripts (npm "allowScripts"),
 * which leaves node_modules/electron without its binary and makes
 * `npm run dev` fail with "Electron uninstall". The root package's own
 * scripts always run, so this runs Electron's installer explicitly. It is a
 * no-op when the binary is already present.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) process.exit(0)

const require = createRequire(import.meta.url)
let dir
try {
  dir = path.dirname(require.resolve('electron/package.json'))
} catch {
  console.error('[ensure-electron] The electron package is not installed. Run `npm install`.')
  process.exit(1)
}

const pathFile = path.join(dir, 'path.txt')
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
const binaryPresent = (file) =>
  existsSync(file) && existsSync(path.join(dir, 'dist', readFileSync(file, 'utf8').trim()))

if (binaryPresent(pathFile)) process.exit(0)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
const runInstaller = (extraEnv) =>
  spawnSync(process.execPath, [path.join(dir, 'install.js')], {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv }
  })

console.log('[ensure-electron] Downloading the Electron binary…')
let res = runInstaller({})
if (res.status !== 0 || !binaryPresent(pathFile)) {
  // A half-extracted dist folder or a corrupt cached zip makes the installer
  // think it is done. Start clean and bypass the download cache once.
  console.log('[ensure-electron] Retrying with a clean download…')
  rmSync(path.join(dir, 'dist'), { recursive: true, force: true })
  rmSync(pathFile, { force: true })
  res = runInstaller({ force_no_cache: 'true' })
}
if (res.status !== 0 || !binaryPresent(pathFile)) {
  const distDir = path.join(dir, 'dist')
  const files = existsSync(distDir) ? readdirSync(distDir) : []
  console.error(
    [
      '',
      '[ensure-electron] Electron could not be installed.',
      `  electron version : ${JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version}`,
      `  installer exit   : ${res.status}${res.error ? ` (${res.error.message})` : ''}`,
      `  path.txt         : ${existsSync(pathFile) ? readFileSync(pathFile, 'utf8') : 'missing'}`,
      `  dist folder      : ${files.length} file(s)${files.length ? ` — ${files.slice(0, 6).join(', ')}` : ''}`,
      `  settings         : ${
        [
          'ELECTRON_SKIP_BINARY_DOWNLOAD',
          'ELECTRON_OVERRIDE_DIST_PATH',
          'ELECTRON_MIRROR',
          'electron_config_cache',
          'HTTPS_PROXY'
        ]
          .filter((k) => process.env[k] !== undefined)
          .map((k) => `${k} is set`)
          .join(', ') || 'none'
      }`,
      '',
      'If the dist folder has files but no electron.exe, your antivirus probably removed it',
      '(Windows Security → Virus & threat protection → Protection history).',
      'Manual install: see "Electron failed to install" in README.md.',
      ''
    ].join('\n')
  )
  process.exit(1)
}
console.log('[ensure-electron] Electron is ready.')
