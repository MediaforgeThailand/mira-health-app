# Mira Motion Compositions

Requirements: Node 22+ and FFmpeg.

Preview:

```powershell
npx hyperframes preview
```

Render one composition:

```powershell
npx hyperframes render . --composition compositions/hero-aurora.html --output ..\public\motion\hero-aurora.mp4 --fps 30 --crf 34
ffmpeg -y -i ..\public\motion\hero-aurora.mp4 -c:v libvpx-vp9 -crf 36 -b:v 0 -an ..\public\motion\hero-aurora.webm
ffmpeg -y -i ..\public\motion\hero-aurora.mp4 -frames:v 1 -q:v 4 ..\public\motion\hero-aurora.jpg
```

Repeat with:

- `referral-flywheel.html` -> `referral-flywheel`
- `miracare-pulse.html` -> `miracare-pulse`
- `mirabeauty-scan.html` -> `mirabeauty-scan`

Budgets:

- `hero-aurora.mp4` <= 2.5MB
- `referral-flywheel.mp4` <= 1.8MB
- `miracare-pulse.mp4` <= 1.5MB
- `mirabeauty-scan.mp4` <= 1.5MB

Verify the loop seam by eye after every render.
