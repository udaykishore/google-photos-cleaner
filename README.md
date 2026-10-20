# Google Photos Cleaner

A Chrome extension that finds and removes duplicate photos and videos directly in your Google Photos library—100% client-side, with zero external cloud uploads and zero OAuth setup.

Forked and enhanced from [Mack Talcott's](https://github.com/mtalcott/google-photos-deduper) original `google-photos-deduper` project.

---

## Demo

[![Demo](https://google-photos-deduper-public.s3.amazonaws.com/demo-2026-l.webp?1)](https://youtu.be/SeOX98uTVwQ)

---

## Key Enhancements in this Fork

* **4-Angle Rotation Invariance:** Evaluates 0°, 90°, 180°, and 270° orientation embeddings so duplicate photos taken in portrait vs. landscape or rotated sideways are reliably detected.
* **Blank & Dark Frame Protection:** Video thumbnails that open with a dark fade-in, black frame, compression noise, or solid color title screen are detected and assigned orthogonal random vectors to prevent false-positive video clustering.
* **Strict Video Duration Matching:** Enforces runtime duration matching within 2 seconds and ensures photos and videos are never mixed in duplicate groups.
* **Exact-Match Fast Path:** Pre-groups byte-identical files (matching size, resolution, and capture timestamp) before fetching thumbnails to drastically speed up large scans.
* **Adaptive Rate-Limit Recovery:** Automatically handles Google Photos' internal `RESOURCE_EXHAUSTED` (status 8) throttling with exponential backoff and request pacing, allowing deep library scans to finish reliably without crashing.
* **Soft Trash Confirmation & Difference Inspector:** Inspect resolution, orientation, and quality differences between duplicate candidates and the designated keep item before confirming moves to trash.
* **Landscape Preference in Keep Selection:** Prioritizes landscape orientation alongside starred favorites and original quality in tie-breakers.

---

## How It Works

Google deprecated write access in the official Google Photos Library API in 2025. This extension uses [Google Photos Toolkit (GPTK)](https://github.com/xob0t/Google-Photos-Toolkit) by [@xob0t](https://github.com/xob0t) to interact with your library via Google Photos' web interface, and runs [MediaPipe](https://developers.google.com/mediapipe)'s MobileNet V3 image embedder locally in a Web Worker to compute visual embeddings.

All processing happens entirely in your browser—no photos, thumbnails, or metadata ever leave your computer.

---

## Install & Usage

1. Clone or download this repository.
2. Build the extension:
   ```bash
   npm install
   npm run build
   ```
3. Open `chrome://extensions` in Google Chrome and enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the `build/chrome-mv3-prod/` directory.
5. Navigate to [Google Photos](https://photos.google.com/).
6. Click the extension icon in your toolbar → **Open Cleaner**.
7. Select **Smart** or **Full** scan and click **Scan Library**.
8. Review duplicate clusters, inspect differences, and click **Move to Trash**.

---

## Development

**Prerequisites:** Google Chrome, Node.js 20+

```bash
# Clone the repository
git clone https://github.com/udaykishore/google-photos-cleaner.git
cd google-photos-cleaner
git submodule update --init --recursive

# Install dependencies
npm install

# Start Plasmo dev server (builds to build/chrome-mv3-dev/)
npm run dev

# Production build (builds to build/chrome-mv3-prod/)
npm run build
```

---

## Credits & Acknowledgments

* **[Mack Talcott](https://github.com/mtalcott/google-photos-deduper):** Creator of the original Google Photos Deduper extension and core architecture.
* **[@xob0t](https://github.com/xob0t):** Author of [Google Photos Toolkit (GPTK)](https://github.com/xob0t/Google-Photos-Toolkit).
* **Gemini Spark:** AI pair-programming partner for rate-limiting resilience, blank-frame vector isolation, and debugging.
