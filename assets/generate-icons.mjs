import sharp from 'sharp'
import { readFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))
const publicDir = join(dir, '..', 'public')

const icon = readFileSync(join(dir, 'icon-source.svg'))
const splash = readFileSync(join(dir, 'splash-source.svg'))

await sharp(icon).resize(1024, 1024).png().toFile(join(dir, 'icon.png'))
await sharp(splash).resize(2732, 2732).png().toFile(join(dir, 'splash.png'))
await sharp(splash).resize(2732, 2732).png().toFile(join(dir, 'splash-dark.png'))

console.log('Generated assets/icon.png and assets/splash.png (+ splash-dark.png)')

// PWA icons: served from public/ so iOS "Add to Home Screen" gets a proper
// app icon without needing the Apple Developer Program / App Store.
mkdirSync(publicDir, { recursive: true })
await sharp(icon).resize(180, 180).png().toFile(join(publicDir, 'apple-touch-icon.png'))
await sharp(icon).resize(192, 192).png().toFile(join(publicDir, 'pwa-192.png'))
await sharp(icon).resize(512, 512).png().toFile(join(publicDir, 'pwa-512.png'))

console.log('Generated public/apple-touch-icon.png, pwa-192.png, pwa-512.png')
