# ReadAloud

Open a PDF, EPUB or text file and have it read to you by the Kokoro voice. Everything runs in your browser, so your files never leave your phone. After the first load it works offline.

## Put it on your iPhone

1. Create a new GitHub repo and upload all the files in this folder to the repo root.
2. In the repo, go to **Settings → Pages**, set the source to **Deploy from a branch**, pick `main` and `/ (root)`, then save.
3. After a minute, open `https://YOUR-USERNAME.github.io/YOUR-REPO/` in **Safari** on your iPhone.
4. Tap **Share → Add to Home Screen**.
5. Open the app, choose a file and press play. The first play downloads the voice model (about 90 MB), so use Wi-Fi.

## Notes

- Supported: PDF (text-based, not scanned), EPUB, TXT, Markdown, HTML.
- Your place in each file is saved on the device. Reopen the same file to resume.
- Speed depends on your iPhone. The next two sentences are prepared while one plays, so playback should stay smooth on recent models.
- To try the GPU in `app.js`, change `dtype: "q8", device: "wasm"` to `dtype: "fp32", device: "webgpu"` (bigger download, faster on supported iOS versions).
- Update the app by pushing changes to GitHub. If the phone shows an old version, close and reopen the app once.
