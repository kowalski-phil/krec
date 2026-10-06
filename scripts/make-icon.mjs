// Draws the Krec icon (dark rounded square, white ring, red record dot) and writes
// assets/icon.png (256 px) and assets/icon.ico (16-256 px, PNG-compressed entries).
// No image libraries needed: pixels are computed directly and PNG-encoded with zlib.
import { mkdirSync, writeFileSync } from 'fs'
import { deflateSync, crc32 } from 'zlib'

const BG = [28, 28, 31]
const RING = [242, 242, 244]
const RED = [229, 56, 59]
const SUPERSAMPLE = 4

// Colour and coverage at a point in unit space (0..1 on both axes).
function shade(u, v) {
  const corner = 0.22
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - corner), 0)
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - corner), 0)
  if (Math.hypot(dx, dy) > corner) return null

  const r = Math.hypot(u - 0.5, v - 0.5)
  if (r <= 0.2) return RED
  if (r >= 0.27 && r <= 0.32) return RING
  return BG
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, hits = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const c = shade((x + (sx + 0.5) / SUPERSAMPLE) / size, (y + (sy + 0.5) / SUPERSAMPLE) / size)
          if (!c) continue
          r += c[0]; g += c[1]; b += c[2]; hits++
        }
      }
      const i = (y * size + x) * 4
      if (hits) {
        pixels[i] = Math.round(r / hits)
        pixels[i + 1] = Math.round(g / hits)
        pixels[i + 2] = Math.round(b / hits)
        pixels[i + 3] = Math.round((255 * hits) / SUPERSAMPLE ** 2)
      }
    }
  }
  return pixels
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0 // filter: none
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function encodeIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(images.length, 4)
  let offset = 6 + images.length * 16
  const entries = images.map(({ size, png }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size // 0 means 256
    e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4) // colour planes
    e.writeUInt16LE(32, 6) // bits per pixel
    e.writeUInt32LE(png.length, 8)
    e.writeUInt32LE(offset, 12)
    offset += png.length
    return e
  })
  return Buffer.concat([header, ...entries, ...images.map((i) => i.png)])
}

const images = [16, 24, 32, 48, 64, 128, 256].map((size) => ({ size, png: encodePng(size, render(size)) }))
mkdirSync('assets', { recursive: true })
writeFileSync('assets/icon.png', images.at(-1).png)
writeFileSync('assets/icon.ico', encodeIco(images))
console.log('Wrote assets/icon.png and assets/icon.ico')
