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
import { existsSync, readFileSync } from 'node:fs'
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
console.log('[ensure-electron] Downloading the Electron binary…')
const res = spawnSync(process.execPath, [path.join(dir, 'install.js')], {
  cwd: dir,
  stdio: 'inherit',
  env: process.env
})
if (res.status !== 0 || !binaryPresent(pathFile)) {
  console.error(
    '\n[ensure-electron] Electron could not be downloaded. Check your internet connection or proxy,\n' +
      'then run:  node node_modules/electron/install.js\n'
  )
  process.exit(1)
}
console.log('[ensure-electron] Electron is ready.')
