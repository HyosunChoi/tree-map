import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const dir = dirname(fileURLToPath(import.meta.url))

const icon = readFileSync(join(dir, 'icon-source.svg'))
const splash = readFileSync(join(dir, 'splash-source.svg'))

await sharp(icon).resize(1024, 1024).png().toFile(join(dir, 'icon.png'))
await sharp(splash).resize(2732, 2732).png().toFile(join(dir, 'splash.png'))
await sharp(splash).resize(2732, 2732).png().toFile(join(dir, 'splash-dark.png'))

console.log('Generated assets/icon.png and assets/splash.png (+ splash-dark.png)')
