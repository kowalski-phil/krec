// The page behind a share link. It is uploaded next to the MP4 and thumbnail and carries
// Open Graph tags, so chat apps show the title and thumbnail when the link is pasted.

export interface SharePageInput {
  title: string
  pageUrl: string
  videoUrl: string
  thumbnailUrl: string
  width: number
  height: number
  durationSec: number
  createdAt: Date
}

const escape = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

// Rounded down, like the browser's video player shows it.
function duration(sec: number): string {
  const s = Math.floor(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

export function renderSharePage(p: SharePageInput): string {
  const t = escape(p.title)
  const when = p.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
  const description = escape(`${duration(p.durationSec)} screen recording · ${when}`)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t}</title>
<meta name="description" content="${description}">
<meta name="robots" content="noindex">
<meta property="og:site_name" content="Krec">
<meta property="og:type" content="video.other">
<meta property="og:title" content="${t}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${escape(p.pageUrl)}">
<meta property="og:image" content="${escape(p.thumbnailUrl)}">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:video" content="${escape(p.videoUrl)}">
<meta property="og:video:secure_url" content="${escape(p.videoUrl)}">
<meta property="og:video:type" content="video/mp4">
<meta property="og:video:width" content="${p.width}">
<meta property="og:video:height" content="${p.height}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${t}">
<meta name="twitter:image" content="${escape(p.thumbnailUrl)}">
<style>
  html, body { margin: 0; height: 100%; background: #111113; color: #e8e8ec;
    font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  main { min-height: 100%; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 14px; padding: 16px; box-sizing: border-box; }
  video { display: block; width: 100%; max-width: ${p.width}px; max-height: 82vh;
    background: #000; border-radius: 8px; }
  .meta { width: 100%; max-width: ${p.width}px; display: flex; justify-content: space-between;
    gap: 12px; font-size: 14px; color: #9a9aa3; }
  .meta b { color: #e8e8ec; font-weight: 600; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
  <video src="${escape(p.videoUrl)}" poster="${escape(p.thumbnailUrl)}" controls playsinline preload="metadata"></video>
  <div class="meta"><span><b>${t}</b> · ${description}</span><a href="${escape(p.videoUrl)}" download>Download</a></div>
</main>
</body>
</html>
`
}
