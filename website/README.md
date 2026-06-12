# Mira Marketing Website

Standalone Astro marketing site for `mira.com`. This project is intentionally isolated from the Expo app and root package.

The landing page route is `/landingpage`; `/` redirects there for local previews and deployed builds.

## Development

```powershell
cd website
npm install
npm run dev
```

## Build and preview

```powershell
cd website
npm run build
npm run preview
```

## Motion assets

HyperFrames compositions live in `motion/compositions/`. Rendered assets are committed in `public/motion/`.

Requirements for rendering: Node 22+ and FFmpeg.

```powershell
cd website\motion
npx hyperframes preview
npx hyperframes render compositions/hero-aurora.html --out ..\public\motion\hero-aurora.mp4
ffmpeg -y -i ..\public\motion\hero-aurora.mp4 -c:v libvpx-vp9 -crf 36 -b:v 0 -an ..\public\motion\hero-aurora.webm
ffmpeg -y -i ..\public\motion\hero-aurora.mp4 -frames:v 1 -q:v 4 ..\public\motion\hero-aurora.jpg
```

Repeat the render/transcode/poster flow for:

- `referral-flywheel`
- `miracare-pulse`
- `mirabeauty-scan`

Verify each loop seam visually in HyperFrames preview before committing.

## Deploy

Create a separate Vercel project with Root Directory set to `website/`. Do not use the root project config for this site.
