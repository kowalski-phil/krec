# Krec — Plan

One-click screen recordings that upload themselves and hand you a share link. A personal, local Loom replacement for Windows.

Written by Fable 5.1 on 2026-10-06 after a four-round requirements interview with Phil. Intended to be executed by Opus. Decisions below are settled; do not re-ask them.

---

## 1. What we are building, in one paragraph

A small always-on-top floating panel on Windows 11. Phil clicks **Record**, picks the screen or a window, optionally turns on a round webcam bubble, and talks. A 3-second countdown runs, then recording starts. He can pause and resume. On **Stop**, the app saves an MP4 locally, uploads it to Bunny Stream, and puts the share link on the clipboard with a Windows notification. The panel keeps a history list so old links can be copied again. The share link opens a full-page player that anyone can watch without logging in, previews with a thumbnail in chat apps, and is unlisted by nature because the video ID is a long random string.

## 2. Decisions from the interview (settled)

| Topic | Decision |
|---|---|
| Trigger | Small floating always-on-top panel with Record / Stop / Pause and a webcam toggle |
| Capture area | Pick a monitor or a window each time (Phil has 1 monitor, but window capture still matters) |
| Audio | Microphone only. No system audio in v1 |
| Webcam | Toggle on the panel. Round bubble, bottom-right, fixed size, baked into the video |
| After Stop | Auto-upload immediately. No title prompt, no preview. Link copied to clipboard. Windows toast when done |
| Link timing (changed by Phil, 2026-10-06) | Bunny's free encoding queue can take many minutes. The link is copied and the toast shown only once Bunny reports status 4 (Finished). Until then the panel shows "In Bunny's queue · N min" / "Bunny encoding… N%" with a "Copy link now" button |
| Clipboard content | Only the share URL, nothing else |
| Video host | **Bunny Stream**. YouTube rejected: its API forces uploads from unaudited projects to private |
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
| API key at rest | Electron `safeStorage` (Windows DPAPI), never plain text |
| Clipboard, toast | `clipboard.writeText`, `new Notification()` |
| Installer | `electron-builder` with NSIS target |

Why the FFmpeg conversion step is required, not optional: Chromium's recorder writes WebM with **Opus** audio. Bunny's supported input audio codecs are AAC, MP3, LPCM, FLAC, WMA and ALAC. Opus is not on the list. The conversion also fixes the known WebM "no duration / not seekable" problem and lets us scale any source to 1080p. Use `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 160k -movflags +faststart`, scaling with `-vf scale=1920:-2` only when the source is wider than 1920.

Fallback if canvas compositing proves too CPU-heavy on Phil's machine: record the raw screen stream with `MediaRecorder` directly (no canvas) and overlay the webcam with FFmpeg's `overlay` filter at conversion time, recording the webcam to a second WebM. Only do this if measured frame drops appear.

## 4. Bunny Stream integration (verified against Bunny docs, 2026-10-06)

Phil creates the account and a **video library** in the Bunny dashboard (Delivery → Stream → Add Video Library). The app needs two values from the library's API tab: **Library ID** and the library's **Stream API key**. These are entered once in the app's Settings screen.

Upload is two HTTP calls, authenticated with header `AccessKey: <stream api key>`:

```text
1. POST https://video.bunnycdn.com/library/{libraryId}/videos
   body: {"title": "Krec 2026-10-06 14-32"}
   -> returns { guid, ... }

2. PUT  https://video.bunnycdn.com/library/{libraryId}/videos/{guid}
   body: raw MP4 bytes (not multipart, not base64)
   -> { "success": true }
```

Share link to copy:

```text
https://player.mediadelivery.net/play/{libraryId}/{guid}
```

Processing status: `GET /library/{libraryId}/videos/{guid}` returns `status` with these meanings: 0 Created, 1 Uploaded, 2 Processing, 3 Transcoding, 4 Finished, 5 Error, 6 UploadFailed, 7 JitSegmenting, 8 JitPlaylistsCreated. Also `encodeProgress` 0 to 100. Poll every 5 seconds until 4, 5 or 6. The link is copied as soon as step 2 succeeds; the history row shows "Processing…" until status 4, then "Ready".

Reliability notes:
- Plain PUT is fine below 2 GB. A 1080p30 recording is roughly 15 to 25 MB per minute, so even an hour fits. TUS resumable upload is a later upgrade, not v1.
- Upload must run from the **main process** (Node), streaming the file from disk, so the renderer never holds the whole file in memory. Report progress to the panel.
- Retry the PUT up to 3 times with backoff on network errors. If it still fails, keep the local file, mark the history row "Upload failed", show a Retry button.
- Library settings that must stay OFF for plain links to work: "Embed view token authentication" and "Block direct URL file access". Mention this in the Settings screen help text.

Cost reference (so nobody over-engineers for cost): storage $0.01 per GB per month, delivery $0.01 per GB in Europe and North America, free standard encoding, $1 monthly minimum. 100 five-minute videos a month each watched 50 times is roughly $5 to $6.

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
- Rows: thumbnail (first frame, grabbed by FFmpeg at conversion time), date-time, duration, status (Processing / Ready / Upload failed), buttons Copy link, Open in browser, Open local file, Retry (only on failure), Delete (local file plus Bunny video; confirm first).
- Stored in `electron-store` as a list of `{ id, title, localPath, bunnyGuid, shareUrl, status, durationSec, createdAt }`.

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
      bunny.ts            createVideo, uploadVideo (streamed PUT), getStatus, deleteVideo
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
4. **Bunny upload**: Settings screen (Library ID, API key via safeStorage, validate button). After step 3 finishes, create + PUT, copy link, toast, poll status. Verify the link plays in a private browser window and unfurls in a Discord or Slack message.
5. **Countdown, pause/resume, elapsed timer, recording states on the panel.**
6. **Webcam bubble**: webcam dropdown in Settings, toggle on panel, canvas compositor with circular clip bottom-right at about 220 px diameter with a 3 px white ring. Check CPU usage; apply the FFmpeg-overlay fallback only if frames drop.
7. **History list** with all actions, retry on failure, delete with confirmation.
8. **Packaging**: `npm run dist` produces `Krec Setup x.y.z.exe`. Install on Phil's machine, run the full flow once from the installed copy.
9. **README** for Phil: how to get the Bunny Library ID and key, where files live, what the three library settings must be.

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
| Bunny upload fails mid-way | Retry with backoff; keep local file; Retry button. TUS later if this is ever hit in practice |
| Windows notification permission or focus assist hides the toast | Clipboard is the primary signal; the panel also shows "Link copied" |
| Phil's mic or webcam default device is wrong | Device dropdowns in Settings, remembered by device ID, with a fallback to default if the device vanishes |

## 10. Later ideas (explicitly out of scope now)

Global hotkey, tray icon and autostart, system audio capture, drag-to-select region, trim before upload, title prompt, cursor highlight and click effects, drawing tools, TUS resumable uploads, a second host such as YouTube behind the same uploader interface.

## 11. Sources used while planning

- Bunny Stream HTTP upload: https://bunny.net/docs/stream/http-api
- Bunny embedding and direct play URL: https://docs.bunny.net/stream/embedding
- Bunny video specification (input containers and codecs): https://bunny.net/docs/stream/video-specification
- Bunny Stream pricing: https://docs.bunny.net/stream/pricing
- Bunny Stream API (OpenAPI): https://docs.bunny.net/docs/api-reference/stream/openapi.json
- YouTube API private lock for unaudited projects: https://www.ayrshare.com/solutions/google-api-error-403-unverified-app-how-to-fix-the-audit-pipeline/
