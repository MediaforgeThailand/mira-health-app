# Mira Marketing Website

Standalone Astro marketing site for `mira.mediaforge.co`. This project is isolated from the Expo app and root package, but is now assembled together with the Expo showcase into a single deployment (see the root `scripts/build-site.mjs`): the live Mira system shell is served at `/` and the Expo app is mounted under `/showcase`.

The Mira landing page lives at `/` (`src/pages/index.astro`) and frames the live Expo system shell from `/showcase/`; `/landingpage` is kept as a permanent redirect to `/` for backward compatibility.

The Mediaforge Marketing Team landing page lives at `/marketing-team` (`src/pages/marketing-team.astro`). It is a motion-first Astro page using the shared font/base CSS, GSAP reveal helpers from `src/scripts/motion.ts`, and source notes in the root `docs/source-audit.md`.

## Development

```powershell
cd website
npm install
npm run dev
```

Open `http://localhost:4321/marketing-team` for the Mediaforge Marketing Team page.

## Build and preview

```powershell
cd website
npm run build
npm run preview
```

After preview starts, open `/marketing-team` on the preview URL to check the static build route.

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
