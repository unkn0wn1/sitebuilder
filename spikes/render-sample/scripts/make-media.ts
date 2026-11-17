// Generate a compressed video hero and posters for the render spike.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'

const root = fileURLToPath(new URL('..', import.meta.url))
const dir = join(root, 'media')
mkdirSync(dir, { recursive: true })

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8a3a16"/>
      <stop offset="50%" stop-color="#c45c2a"/>
      <stop offset="100%" stop-color="#5c2a14"/>
    </linearGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#g)"/>
  <circle cx="980" cy="180" r="220" fill="#f0c27a" fill-opacity="0.35"/>
  <circle cx="200" cy="560" r="280" fill="#2a1208" fill-opacity="0.25"/>
</svg>`

const master = await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer()
writeFileSync(join(dir, 'hero-poster-source.jpg'), master)

await sharp(master).resize(1280, 720).webp({ quality: 72 }).toFile(join(dir, 'hero-poster-1280.webp'))
await sharp(master).resize(640, 360).avif({ quality: 45, effort: 6 }).toFile(join(dir, 'hero-poster-640.avif'))
await sharp(master).resize(640, 360).webp({ quality: 70 }).toFile(join(dir, 'hero-poster-640.webp'))

const ff = spawnSync(
  'ffmpeg',
  [
    '-y',
    '-loop', '1',
    '-i', join(dir, 'hero-poster-source.jpg'),
    '-t', '4',
    '-vf', "scale=854:480,zoompan=z='min(zoom+0.0008,1.06)':d=100:s=854x480:fps=25",
    '-an',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '-profile:v', 'main',
    '-crf', '28',
    '-movflags', '+faststart',
    join(dir, 'hero.mp4'),
  ],
  { encoding: 'utf8' },
)
if (ff.status !== 0) {
  console.error(ff.stderr)
  process.exit(ff.status ?? 1)
}
console.log('Wrote posters and hero.mp4 in', dir)
