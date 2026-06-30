# Mediaforge Marketing Team Landing Page Source Audit

Updated: 2026-06-19

This audit supports the `/marketing-team` landing page. It records the sources opened before design/coding, what was borrowed, and what could not be accessed from this session.

## GitHub Design References

### VoltAgent / awesome-design-md

- Source: https://github.com/VoltAgent/awesome-design-md.git
- Local clone: `.refs/awesome-design-md`
- Files opened:
  - `.refs/awesome-design-md/README.md`
  - `.refs/awesome-design-md/design-md/elevenlabs/DESIGN.md`
  - `.refs/awesome-design-md/design-md/x.ai/DESIGN.md`
  - `.refs/awesome-design-md/design-md/linear.app/DESIGN.md`
  - `.refs/awesome-design-md/design-md/vercel/DESIGN.md`
- Used for:
  - Dark cinematic canvas and atmospheric restraint from xAI/Linear.
  - Technical mono-label logic from xAI/Vercel, adapted with existing Space Grotesk and Anuphan fonts.
  - Product/system-card density from Linear, but without copying Linear's brand accent.
  - Vercel-style mesh-gradient-at-hero-scale idea, adapted into a darker Mediaforge growth-system map.
  - ElevenLabs' editorial restraint: fewer claims, fewer paragraphs, soft confidence.

### megh-bari / pattern-craft

- Source: https://github.com/megh-bari/pattern-craft.git
- Local clone: `.refs/pattern-craft`
- Files opened:
  - `.refs/pattern-craft/README.md`
  - `.refs/pattern-craft/src/data/patterns.ts`
- Patterns adapted:
  - `dark-horizon-glow`: dark radial horizon, adapted as the page's low-glow base.
  - `dual-gradient-overlay-*`: grid plus two soft directional gradients, adapted into the hero/section mesh.
  - `top-spotlight`: subtle top spotlight, used in CTA/final activation bands.
  - `aurora-edge-glow`: edge glow, adapted for evidence/proof panels.
  - `cosmic-nebula`: multi-color low-opacity mesh, adapted with lower saturation.
  - `diagonal-striped-grid`: masked grid/stripe idea, adapted into data-pulse and pipeline textures.

## Mediaforge / Product Sources

### studio.mediaforge.co

- Source: https://studio.mediaforge.co
- Access: HTTP 200
- Observed title: `MEDIAFORGE — Production House`
- Used for: Creative-production proof category and production-house tone. The fetched public HTML was minimal, so the page uses source-backed category labels without inventing reel assets or client claims.

### mediaforge.co

- Source: https://mediaforge.co
- Access: HTTP 200, redirected to `https://www.mediaforge.co/`
- Observed title: `MediaForge`
- Used for: Company-level brand source. Public HTML was minimal in this fetch, so it is referenced as brand presence rather than detailed proof.

### mira.mediaforge.co

- Source: https://mira.mediaforge.co
- Access: HTTP 200
- Observed title: `Mira — Enterprise AI Sales Platform | AI Sales Chat + Referral Engine สำหรับองค์กร`
- Used for:
  - Structural message: not a ready-made chatbot, but a system designed for the real organization.
  - Dark/blue technical product-site tone, motion loops, system diagrams, and Thai-first enterprise copy style.
  - Adapted positioning for this page: not an agency package, but a team designed around the actual business.

### Canva link

- Source: https://canva.link/tegbibzcufs0c4z
- Access: blocked from this session, HTTP 403.
- Used for: The proof wall includes a clearly marked Video / Graphic placeholder card that is ready to swap with real Canva thumbnails/assets later.

### Ads / Data Analytics Portfolio

- Source: https://www.mediaforge.co/taksin/portfolio
- Access: HTTP 200
- Observed title: `MediaForge`
- Used for: Ads/data proof category and KPI/dashboard visual metaphor. The fetched public HTML did not expose detailed portfolio entries in this session, so the page avoids invented clients, numbers, awards, or campaign results.

## Founder Profile / CV Source

- Source requested in brief: `Taksin_Taeprasert_CV(3).pdf`
- Workspace status: no matching PDF was found in the Mira Application workspace during this run.
- Used from owner brief only:
  - Positioning as AI Product Designer, System Analyst, Performance Marketing & Business Operations Lead.
  - Capabilities across AI workflow, product design, business process, ads, analytics, UX/UI, website, web app, and creative/video direction.
  - Ad budget experience range stated in the brief: 100K-500K+ THB/month, with some Google Ads periods around 400K/month.
- Guardrail: no additional numbers, clients, awards, or performance claims were invented.

## Design Synthesis

- Primary metaphor: scattered business work becomes one growth operating system.
- Visual system: near-black cinematic canvas, restrained cyan/mint/amber/violet accents, system map, orbit, split model, pipeline, and proof wall.
- Motion system: node connection, orbit, card reveal, data pulse, proof-wall hover, subtle spotlight, and background pattern drift; reduced motion is respected.
- Copy system: Thai-first, short, direct, operator-minded. No long service paragraphs.
