# Krec

One-click screen recordings that upload themselves and hand you a share link. A personal Loom replacement for Windows.

Click **Record**, pick a screen or window, talk. Click **Stop**. A few seconds later the share link is on your clipboard and anyone can watch it in a browser, no login needed. Posting to Skool instead? Drag the recording from Krec's History straight into the post.

---

## Install or update

1. Run `Krec Setup x.y.z.exe` (built into `dist\`, see [For developers](#for-developers)).
2. Windows may show **"Windows protected your PC"** because the installer is not code-signed. Click **More info**, then **Run anyway**.
3. It installs in a few seconds and adds **Krec** to the Start menu and the desktop.

To update, quit Krec (✕ on the panel) and run the newer installer. Settings, history and videos are kept.

## One-time AWS setup

Krec uploads to your own AWS account: a private S3 bucket for the files and CloudFront for fast HTTPS links. Nothing is re-encoded, so a link works the moment the upload finishes.

1. Log in to the AWS console. Type **CloudShell** in the top search box and open it.
2. Paste this and press Enter:

   ```
   curl -fsSLO https://raw.githubusercontent.com/kowalski-phil/krec/main/scripts/aws-setup.sh && bash aws-setup.sh
   ```

   It creates the bucket (in Frankfurt, `eu-central-1`), the CloudFront distribution and an upload-only user, then prints one line starting with `krec1:`.
3. In Krec, open **⚙ Settings**, paste that line into **Setup code**, click **Test connection**, then **Save**.
   - "CloudFront does not serve the file yet": a new distribution takes 5 to 15 minutes to go live. Try again later.
   - "Your account must be verified before you can add new CloudFront resources": some new AWS accounts need a free support case under **Account and billing** first.

The `krec1:` line contains a secret key. Paste it only into Krec. Krec stores it encrypted with Windows (DPAPI), never as plain text.

## Everyday use

| You want to | Do this |
|---|---|
| Record | **Record** → pick a screen or window → 3-2-1 countdown → talk → **Stop**. Click **Cancel** during the countdown to throw it away. |
| Take a break mid-recording | **Pause** / **Resume**. Paused time is not in the video. |
| Show your face | Tick **Webcam** on the panel. A round bubble is recorded in the bottom-right corner. |
| Share a link | After Stop, wait for **Link copied ✓**, then paste anywhere. A notification also says so. |
| Post to Skool | **☰ History** → drag the thumbnail into the Skool post, or **Copy video file** and press Ctrl+V in the post. Skool only plays YouTube, Vimeo, Loom and Wistia links, so the file itself gives the best result there. |
| Find an old recording | **☰ History**: Copy link, Open in browser, Copy video file, Show file. |
| Fix a failed upload | **☰ History** → **Retry**. The video is always kept on your PC first. |
| Remove a recording | **☰ History** → **Delete**. Removes the file on your PC and the online copy; the link stops working. |
| Pick mic, camera or folder | **⚙ Settings**. Speak to check the level bar; the round preview shows the camera. |

The Krec panel hides itself from your recordings, so it never appears in a video.

## Where things live

| What | Where |
|---|---|
| Your videos (MP4) | `%USERPROFILE%\Videos\Krec` (changeable in Settings) |
| Settings, history, thumbnails | `%APPDATA%\Krec` |
| Shared videos | Your S3 bucket `krec-<account>-<suffix>`, served at `https://<id>.cloudfront.net/v/<random id>` |

Each share link is a long random id, so links are unlisted: nobody can guess or list them.

## What it costs

S3 storage is about $0.023 per GB per month. CloudFront's permanent free tier covers 1 TB of viewing traffic and 10 million requests per month. A five-minute screen recording is typically 10 to 100 MB. For personal use that is a few cents to a couple of dollars a month.

## Troubleshooting

| Problem | Fix |
|---|---|
| Video has no sound | **⚙ Settings → Microphone**: pick your mic and speak; the bar must move. While recording, the panel names the mic in use and warns "No sound from mic" if it is silent. A mic that is on the other side of a USB switch falls back to the Windows default until it is back. |
| "No webcam found" while recording | The camera is unplugged or used by another app. Recording continues without the bubble. |
| "Upload failed" | Usually the network. **☰ History → Retry**. Hover the red label for the exact reason. |
| "Saved locally (AWS not set up)" | Do the [one-time AWS setup](#one-time-aws-setup), then **History → Upload**. |
| Notification does not appear | Windows Focus Assist / Do Not Disturb hides it. The link is on the clipboard anyway. |

## Removing the AWS resources

This deletes **every uploaded video** (all share links stop working), the CloudFront distribution and the upload user. Videos on your PC are not touched.

1. Note your bucket name from **⚙ Settings** ("Connected: bucket krec-…").
2. In AWS CloudShell:

   ```
   curl -fsSLO https://raw.githubusercontent.com/kowalski-phil/krec/main/scripts/aws-teardown.sh && bash aws-teardown.sh krec-YOUR-BUCKET-NAME
   ```

3. Type the bucket name again to confirm. Disabling CloudFront takes AWS 5 to 15 minutes; the script waits and then finishes on its own.

## Uninstall

Windows **Settings → Apps → Installed apps → Krec → Uninstall**. Your videos in `Videos\Krec` and the settings in `%APPDATA%\Krec` stay; delete those folders by hand if you want them gone.

---

## For developers

Requirements: Node.js 22.12+ and npm on Windows.

```
npm install
npm run dev        # run Krec with hot reload
npm run typecheck
npm run dist       # build dist\Krec Setup x.y.z.exe
npm run icon       # regenerate assets\icon.ico / icon.png
```

- `KREC_USER_DATA=<folder>` runs Krec with a separate profile (settings, history), so tests never upload to the real bucket or touch the real history. Only one Krec per profile can run at a time.
- Stack: Electron 44, TypeScript, electron-vite, MediaRecorder, a canvas compositor for the webcam bubble, ffmpeg-static (WebM → H.264/AAC MP4), AWS SDK v3, electron-store, electron-builder (NSIS).
- Main process (`src/main`) does all file, FFmpeg and network work. Renderers (`src/renderer`) are sandboxed with context isolation and talk to main only through the typed API in `src/preload`.
- Design decisions, their reasons and the build history are in [PLAN.md](PLAN.md).
