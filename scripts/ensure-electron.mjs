/**
 * Makes sure Electron's binary is installed (runs on `npm install`, before
 * `npm run dev` and `npm start`).
 *
 * Two real-world failures this handles:
 * - Newer npm versions can skip dependency install scripts, so Electron's own
 *   download never runs.
 * - Electron's installer can exit "successfully" after unpacking only part of
 *   the zip (seen on Windows with recent Node versions: only `locales/`).
 *
 * The check looks for the executable itself and never deletes a working
 * install. If Electron's installer does not produce the executable, the zip is
 * downloaded with Electron's own downloader (checksum-verified) and extracted
 * with the operating system's unzip tool.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const version = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).version
const exeName =
  process.platform === 'win32'
    ? 'electron.exe'
    : process.platform === 'darwin'
      ? 'Electron.app/Contents/MacOS/Electron'
      : 'electron'
const distDir = path.join(dir, 'dist')
const exePath = path.join(distDir, exeName)
const pathFile = path.join(dir, 'path.txt')

/** Writes the two marker files Electron uses to locate its executable. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- plain JS script
function finalize() {
  writeFileSync(pathFile, exeName)
  writeFileSync(path.join(distDir, 'version'), version)
}

if (existsSync(exePath)) {
  let current = ''
  try {
    current = readFileSync(pathFile, 'utf8')
  } catch {
    // missing marker file — rewritten below
  }
  if (current !== exeName) finalize()
  process.exit(0)
}

console.log(`[ensure-electron] Installing Electron ${version}…`)
spawnSync(process.execPath, [path.join(dir, 'install.js')], {
  cwd: dir,
  stdio: 'inherit',
  env: process.env
})
if (existsSync(exePath)) {
  finalize()
  console.log('[ensure-electron] Electron is ready.')
  process.exit(0)
}

console.log('[ensure-electron] Electron’s installer did not unpack the app; unpacking it directly…')
let zipPath
try {
  const { downloadArtifact } = createRequire(path.join(dir, 'install.js'))('@electron/get')
  zipPath = await downloadArtifact({
    version,
    artifactName: 'electron',
    platform: process.platform,
    arch: process.env.npm_config_arch || process.arch,
    checksums: JSON.parse(readFileSync(path.join(dir, 'checksums.json'), 'utf8'))
  })
} catch (err) {
  console.error(`[ensure-electron] Download failed: ${err.message}`)
}

if (zipPath) {
  rmSync(distDir, { recursive: true, force: true })
  mkdirSync(distDir, { recursive: true })
  const res =
    process.platform === 'win32'
      ? spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${distDir.replace(/'/g, "''")}' -Force`
          ],
          { stdio: 'inherit' }
        )
      : spawnSync('unzip', ['-o', '-q', zipPath, '-d', distDir], { stdio: 'inherit' })
  if (res.error) console.error(`[ensure-electron] Unzip failed: ${res.error.message}`)
}

if (existsSync(exePath)) {
  finalize()
  console.log('[ensure-electron] Electron is ready.')
  process.exit(0)
}

console.error(
  [
    '',
    '[ensure-electron] Electron could not be installed.',
    `  expected file : ${exePath}`,
    `  downloaded zip: ${zipPath ?? 'none'}`,
    '',
    'If the zip was downloaded but the .exe is missing after unpacking, your antivirus probably',
    'removed it (Windows Security → Virus & threat protection → Protection history).',
    'Manual install: see "Electron failed to install" in README.md.',
    ''
  ].join('\n')
)
process.exit(1)
