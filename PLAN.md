# Krec — Plan

One-click screen recordings that upload themselves and hand you a share link. A personal, local Loom replacement for Windows.

Written by Fable 5.1 on 2026-10-06 after a four-round requirements interview with Phil. Intended to be executed by Opus. Decisions below are settled; do not re-ask them.

---

## 1. What we are building, in one paragraph

A small always-on-top floating panel on Windows 11. Phil clicks **Record**, picks the screen or a window, optionally turns on a round webcam bubble, and talks. A 3-second countdown runs, then recording starts. He can pause and resume. On **Stop**, the app saves an MP4 locally, uploads it to AWS (S3 + CloudFront), and puts the share link on the clipboard with a Windows notification. The panel keeps a history list so old links can be copied again. The share link opens a full-page player that anyone can watch without logging in, previews with a thumbnail in chat apps, and is unlisted by nature because the video ID is a long random string.

## 2. Decisions from the interview (settled)

| Topic | Decision |
|---|---|
| Trigger | Small floating always-on-top panel with Record / Stop / Pause and a webcam toggle |
| Capture area | Pick a monitor or a window each time (Phil has 1 monitor, but window capture still matters) |
| Audio | Microphone only. No system audio in v1 |
| Webcam | Toggle on the panel. Round bubble, bottom-right, fixed size, baked into the video |
| After Stop | Auto-upload immediately. No title prompt, no preview. Link copied to clipboard. Windows toast when done |
| Clipboard content | Only the share URL, nothing else |
| Video host (changed 2026-10-06) | **AWS S3 + CloudFront**, no transcoding. YouTube rejected: its API forces uploads from unaudited projects to private. Bunny Stream rejected after a live test: a 20-second video sat 9+ minutes in its free encoding queue at 0%. Never re-propose a queue-based transcoding host |
| Quality | 1080p at 30 fps |
| Local files | Keep every recording in `%USERPROFILE%\Videos\Krec` |
| Extras in v1 | 3-second countdown, pause/resume, history list with past links |
| Not in v1 | System audio, region drag-select, trimming, drawing, hotkeys, tray icon, autostart |
| Engine | Self-contained. No OBS, no separate FFmpeg install |
| Packaging | Windows installer (.exe), Start-menu entry |
| Tech stack | Phil has no preference. Recommendation below: Electron |

## 3. Why Electron

Plain-English reason: Electron is a bundled Chrome browser plus Node. Chrome already knows how to list screens and windows, capture them, grab the webcam and mic, and record all of it to a file. That means no FFmpeg capture setup, no device-name guessing, and the window picker comes with thumbnails for free. Pause/resume is a built-in feature of the browser's recorder.

Technical mapping:

| Need | Electron / Chromium feature |
|---|---|
| List screens and windows with thumbnails | `desktopCapturer.getSources()` in main, shown in a picker window |
| Capture the chosen source | `navigator.mediaDevices.getUserMedia` with `chromeMediaSourceId` (set via `session.setDisplayMediaRequestHandler` on current Electron) |
| Microphone | `getUserMedia({ audio: { deviceId } })` |
| Webcam bubble | `getUserMedia({ video })`, drawn as a clipped circle onto a canvas together with the screen frames |
| Recording | `MediaRecorder` on `canvas.captureStream(30)` plus the mic track. Native `pause()` / `resume()` |
| Final MP4 | `ffmpeg-static` (npm package, binary ships inside the app) converts the WebM to H.264 + AAC MP4 |
| Settings and history | `electron-store` (JSON file in `%APPDATA%\Krec`) |
| AWS secret key at rest | Electron `safeStorage` (Windows DPAPI), never plain text |
| Clipboard, toast | `clipboard.writeText`, `new Notification()` |
| Installer | `electron-builder` with NSIS target |

Why the FFmpeg conversion step is required, not optional: Chromium's recorder writes WebM, and the share link serves the file as-is with no host-side transcoding, so it must be an MP4 (H.264 + AAC, faststart) that every browser and phone plays. The conversion also fixes the known WebM "no duration / not seekable" problem and lets us scale any source to 1080p. Use `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart`, scaling with `-vf scale=1920:-2` only when the source is wider than 1920.

Fallback if canvas compositing proves too CPU-heavy on Phil's machine: record the raw screen stream with `MediaRecorder` directly (no canvas) and overlay the webcam with FFmpeg's `overlay` filter at conversion time, recording the webcam to a second WebM. Only do this if measured frame drops appear.

## 4. AWS S3 + CloudFront integration (verified against AWS docs, 2026-10-06)

Plain-English idea: Krec's MP4 already plays in every browser, so nothing needs re-encoding. Krec uploads three files to a private S3 bucket and CloudFront serves them over HTTPS. The link works the moment the upload finishes.

One-time setup: Phil runs `scripts/aws-setup.sh` in AWS CloudShell. It creates a private bucket (Block Public Access on), a CloudFront distribution reading it through Origin Access Control (bucket policy limited to that distribution's ARN), and an IAM user that may only `PutObject/GetObject/DeleteObject/AbortMultipartUpload` in the bucket and `CreateInvalidation` on the distribution. It prints one `krec1:<base64 JSON>` setup code (region, bucket, access key, secret, CloudFront domain, distribution ID) that Phil pastes into Settings. Settings tests it end to end (write to S3, read back through CloudFront, delete) before saving; the secret is stored with safeStorage.

Per recording, with a random 128-bit id (unlisted by nature):

```text
v/<id>.mp4   video/mp4                 Cache-Control: immutable, 1 year   (multipart, 8 MB parts)
v/<id>.jpg   image/jpeg (1280 wide)    Cache-Control: immutable, 1 year
v/<id>       text/html share page      Cache-Control: 5 minutes           (uploaded last)
```

Share link: `https://<distribution>.cloudfront.net/v/<id>`. The page has a native `<video>` player and Open Graph tags (`og:title`, `og:image`, `og:video`) so chat apps show title and thumbnail. Slack plays inline only for allowlisted hosts (YouTube, Loom, Vimeo); everyone else, Krec included, gets a title + thumbnail card.

Reliability: SDK retries each request 3 times; Krec retries the whole file up to 3 more times with 2/5/10 s backoff. On failure the local file is kept, the history row is "Upload failed" with a Retry button. Deleting (step 7) removes the three objects and invalidates them in CloudFront.

Cost reference: S3 Standard $0.023 per GB-month; CloudFront's always-free tier covers 1 TB transfer and 10 M requests per month. 100 five-minute videos a month watched 50 times each is roughly $0 to $2 per month.

Known risk: brand-new AWS accounts may need AWS Support to verify the account before CloudFront resources can be created (free "Account and billing" case).

## 5. User flows

**First run**
1. Panel opens. Settings screen appears because no Library ID is stored.
2. Phil pastes Library ID and API key. App calls `GET /library/{libraryId}/videos?itemsPerPage=1` to validate. Green check or clear error.
3. Settings also show mic dropdown, webcam dropdown, save folder (default `Videos\Krec`), quality (fixed 1080p30 in v1, shown read-only).

**Recording**
1. Click **Record**. Picker window lists "Entire screen" and every open window, with thumbnails.
2. Choose a source. Panel shrinks to a thin bar: countdown 3, 2, 1.
3. Recording. Bar shows elapsed time, red dot, **Pause**, **Stop**. If webcam toggle was on, the bubble is already composited into the output. A small live preview of the bubble is optional; not needed in v1.
4. **Stop**. Bar shows "Saving…" (FFmpeg conversion, typically a fraction of the recording length), then "Uploading… 43%", then "Link copied" with a toast. Clipboard holds only the URL.
5. Panel returns to idle. New row at the top of History.

**History**
- Rows: thumbnail (first frame, grabbed by FFmpeg at conversion time), date-time, duration, status (Uploading / Ready / Upload failed), buttons Copy link, Open in browser, Open local file, Retry (only on failure), Delete (local file plus the uploaded files; confirm first).
- Stored in `electron-store` as a list of `{ id, title, localPath, thumbnailPath, width, height, durationSec, createdAt, status, error, remoteId, remoteDomain, shareUrl, uploadedAt }`.

## 6. Project layout

```text
Krec/
  package.json
  electron-builder.yml
  src/
    main/
      index.ts            app lifecycle, windows, IPC wiring
      capture.ts          desktopCapturer sources, display-media handler
      recorder-ipc.ts     receives WebM chunks from renderer, writes to disk
      convert.ts          ffmpeg-static: webm -> mp4, thumbnail extraction
      aws.ts              setup-code parsing, S3 upload (multipart), delete, end-to-end test
      sharepage.ts        HTML share page with Open Graph tags
      uploads.ts          upload job: retries, history status, link copy
      store.ts            electron-store schema: settings + history
      secrets.ts          safeStorage wrap/unwrap for the API key
      notify.ts           toast + clipboard
    renderer/
      panel/              floating panel UI (idle / countdown / recording / finishing)
      picker/             source picker window
      settings/           settings window
      recording/
        compositor.ts     canvas: screen frames + webcam circle
        recorder.ts       MediaRecorder lifecycle, pause/resume, chunk streaming to main
    shared/
      ipc.ts              typed channel names and payloads
      types.ts
  assets/                 icon.ico, tray-less
  PLAN.md                 this file
```

Keep the renderer free of Node access (`contextIsolation: true`, `nodeIntegration: false`, a preload exposing a small typed API). All file and network work lives in main.

## 7. Build order for Opus

Work in this order. Each step ends with something Phil can click and verify.

1. **Scaffold**: Electron + TypeScript + Vite (electron-vite or similar), `electron-builder` NSIS config, app icon. `npm run dev` opens an empty always-on-top panel. Commit.
2. **Source picker + raw recording**: picker lists sources, choose one, record 10 seconds of screen plus mic to a WebM in `Videos\Krec`. Verify the file plays in VLC or Chrome.
3. **Conversion**: `ffmpeg-static` turns the WebM into MP4 and extracts a thumbnail. Verify the MP4 plays in Windows Media Player and is seekable.
4. **Upload** (done, switched from Bunny to AWS): Settings screen (AWS setup code, mic picker, folder), upload after step 3, copy link, toast. Verify the link plays in a private browser window and unfurls in a Discord or Slack message.
5. **Countdown, pause/resume, elapsed timer, recording states on the panel.**
6. **Webcam bubble**: webcam dropdown in Settings, toggle on panel, canvas compositor with circular clip bottom-right at about 220 px diameter with a 3 px white ring. Check CPU usage; apply the FFmpeg-overlay fallback only if frames drop.
7. **History list** with all actions, retry on failure, delete with confirmation.
8. **Packaging**: `npm run dist` produces `Krec Setup x.y.z.exe`. Install on Phil's machine, run the full flow once from the installed copy.
9. **README** for Phil: how to run the AWS setup script in CloudShell, where files live, how to remove the AWS resources.

## 8. Acceptance test (what "done" means)

- From idle, Phil reaches a copied share link with exactly these clicks: Record, pick source, Stop. Nothing else.
- The link plays in a browser where Phil is not logged in to anything.
- The link pasted into a chat app shows a title and thumbnail preview.
- A 10-minute recording with webcam bubble on shows no visible stutter and audio stays in sync to the end.
- Unplugging the network during upload results in a "Upload failed" row with a working Retry, and the local MP4 is intact.
- Closing and reopening the app keeps settings and history.
- The API key does not appear in plain text in any file under `%APPDATA%\Krec`.

## 9. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| Canvas compositing at 1080p30 loads the CPU | Measure in step 6. Fallback: FFmpeg overlay at conversion time |
| Electron display-media API changed between versions | Pin the Electron major version in package.json and read that version's docs before coding `capture.ts` |
| Long recordings produce a large in-memory WebM in the renderer | Stream `MediaRecorder` chunks to main every 1 second and append to disk; never buffer the whole file |
| Upload fails mid-way | Retry with backoff; keep local file; Retry button. multipart parts are retried individually |
| Windows notification permission or focus assist hides the toast | Clipboard is the primary signal; the panel also shows "Link copied" |
| Phil's mic or webcam default device is wrong | Device dropdowns in Settings, remembered by device ID, with a fallback to default if the device vanishes |

## 10. Later ideas (explicitly out of scope now)

Global hotkey, tray icon and autostart, system audio capture, drag-to-select region, trim before upload, title prompt, cursor highlight and click effects, drawing tools, TUS resumable uploads, a second host such as YouTube behind the same uploader interface.

## 11. Sources used while planning

- CloudFront Origin Access Control for S3: https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/private-content-restricting-access-to-s3.html
- S3 pricing 2026: https://www.cloudzero.com/blog/s3-pricing/
- CloudFront always-free tier: https://cloudburn.io/blog/amazon-cloudfront-pricing
- CloudFront account verification for new accounts: https://repost.aws/questions/QUdTw0Ch8oQKqSOvHC0r_ORg
- Slack inline video allowlist: https://docs.slack.dev/reference/block-kit/blocks/video-block
- Why Bunny was dropped (shared encoding queue): https://support.bunny.net/hc/en-us/articles/8533825870236-Troubleshooting-Bunny-Stream-Video-Uploads
- YouTube API private lock for unaudited projects: https://www.ayrshare.com/solutions/google-api-error-403-unverified-app-how-to-fix-the-audit-pipeline/
