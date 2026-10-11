// Rasterizes the bookmark mark from ../../linkpark-logo.svg (wordmark cropped out).
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

// Paths from the logo, with the group's translate(0 8) baked into y.
// Bookmark bbox is x 270–530, y 90–383. The square hugs that box so the mark fills the icon.
const VIEW = { x: 239, y: 75.5, size: 322 }
// Lighter than the wordmark's #173F35 so the toolbar icon stays readable.
const GREEN = [0x3c, 0xb8, 0x88]

const cubic = (p0, p1, p2, p3, steps = 32) => {
  const pts = []
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    pts.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return pts
}

const outline = (cmds) => {
  const pts = []
  let cur = [0, 0]
  for (const c of cmds) {
    if (c[0] === 'M' || c[0] === 'L') {
      cur = [c[1], c[2]]
      pts.push(cur)
    } else if (c[0] === 'C') {
      const end = [c[5], c[6]]
      pts.push(...cubic(cur, [c[1], c[2]], [c[3], c[4]], end))
      cur = end
    }
  }
  return pts
}

const bookmark = outline([
  ['M', 310, 90],
  ['C', 286, 90, 270, 108, 270, 132],
  ['L', 270, 358],
  ['C', 270, 374, 281, 383, 295, 375],
  ['L', 400, 315],
  ['L', 505, 375],
  ['C', 519, 383, 530, 374, 530, 358],
  ['L', 530, 132],
  ['C', 530, 108, 514, 90, 490, 90],
])

const leaf = outline([
  ['M', 337, 286],
  ['C', 326, 235, 345, 185, 399, 158],
  ['C', 424, 146, 451, 138, 470, 134],
  ['C', 472, 170, 467, 212, 449, 244],
  ['C', 430, 278, 399, 297, 365, 309],
  ['C', 367, 280, 383, 246, 413, 213],
  ['C', 380, 231, 354, 257, 337, 286],
])

const inside = (pts, x, y) => {
  let n = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) n++
  }
  return n % 2 === 1
}

const ss = 4
mkdirSync('public/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) {
  const buf = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = VIEW.x + ((px + (sx + 0.5) / ss) / size) * VIEW.size
          const y = VIEW.y + ((py + (sy + 0.5) / ss) / size) * VIEW.size
          if (inside(bookmark, x, y) && !inside(leaf, x, y)) hit++
        }
      }
      const i = (py * size + px) * 4
      buf[i] = GREEN[0]
      buf[i + 1] = GREEN[1]
      buf[i + 2] = GREEN[2]
      buf[i + 3] = Math.round((hit / (ss * ss)) * 255)
    }
  }
  writeFileSync(`public/icons/icon-${size}.png`, png(size, buf))
}
console.log('icons written to public/icons')
