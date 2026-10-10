// Generates the toolbar icons as PNGs without external dependencies.
// Usage: node scripts/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
const png = (size, rgba) => {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Shape in unit coordinates: rounded square background + bookmark ribbon.
const inRoundRect = (x, y, r) => {
  const cx = Math.min(Math.max(x, r), 1 - r)
  const cy = Math.min(Math.max(y, r), 1 - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}
const inRibbon = (x, y) => {
  const l = 0.32, rgt = 0.68, top = 0.22, bot = 0.8, notch = 0.6
  if (x < l || x > rgt || y < top || y > bot) return false
  const mid = (l + rgt) / 2
  const notchY = notch + (Math.abs(x - mid) / (mid - l)) * (bot - notch)
  return y <= notchY
}

const bg = [79, 70, 229]
const ss = 4
mkdirSync('public/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let cov = 0, white = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = (px + (sx + 0.5) / ss) / size
          const y = (py + (sy + 0.5) / ss) / size
          if (inRoundRect(x, y, 0.22)) {
            cov++
            if (inRibbon(x, y)) white++
          }
        }
      }
      const n = ss * ss
      const a = cov / n
      const w = cov ? white / cov : 0
      const i = (py * size + px) * 4
      buf[i] = Math.round(bg[0] + (255 - bg[0]) * w)
      buf[i + 1] = Math.round(bg[1] + (255 - bg[1]) * w)
      buf[i + 2] = Math.round(bg[2] + (255 - bg[2]) * w)
      buf[i + 3] = Math.round(a * 255)
    }
  }
  writeFileSync(`public/icons/icon-${size}.png`, png(size, buf))
}
console.log('icons written to public/icons')
