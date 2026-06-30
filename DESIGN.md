# Mira AI Sales and MarTech Design System

## Direction

Mira should feel like an operating system for AI-led sales, referral growth, and commerce operations. It is not a medical dashboard and not a marketing landing page. The interface should be quiet, direct, and built for repeated operational use.

The primary product surfaces are:

- AI Commerce Chat
- Admin Commerce
- Referral Program
- Sales and order dashboard

Legacy healthcare dashboard screens are archived. They should not appear in the active navigation or define the new visual direction.

## Color

- Canvas: `#EEF6FF`
- Surface: `#FFFFFF`
- Soft surface: `#F8FBFF`
- Ink: `#071D49`
- Soft ink: `#385780`
- Primary action: `#176BFF`
- Deep action: `#0A3A9E`
- Success/referral: `#18B883`
- Warning: `#F5B84B`
- Danger: `#D84A4A`
- Line: `#C6E0FA`

Use blue for system/action, mint for successful commerce/referral state, amber for attention, and red only for destructive or failed states.

## Type

Use compact, scan-friendly typography:

- Page title: 28-34px
- Section heading: 18-22px
- Card/table row title: 15-17px
- Body: 13-15px
- Labels/chips: 11-13px

Letter spacing stays `0`. Do not scale font size with viewport width.

## Layout

Primary screens should be operational:

- real tables/lists over marketing cards
- clear row actions
- predictable filters and status chips
- compact panels without nested cards
- mobile-first, but desktop should feel like a real workspace

The root page is a system directory: rows grouped by AI Sales Chat, Admin Commerce, and Referral Program. It is not a showcase gallery.

## Component Rules

- Use buttons for commands and links for navigation.
- Use status chips for auth/setup/order states.
- Use tables or rows for directories, orders, and catalog lists.
- Use cards only for individual tools, summaries, and empty/error states.
- Do not place UI cards inside other cards.
- Do not create new mockup ribbons for primary routes.

## AI Sales Chat

Chat should feel like a real sales operator:

- customer messages and assistant answers are the core
- catalog cards are rendered from backend data
- order panels show the exact next step
- auth/setup errors are explicit
- voice or future-channel affordances must not appear unless functional

## Admin Commerce

Admin should feel like a work console:

- catalog management is the source of truth for what AI can sell
- orders separate service booking work from physical fulfillment work
- every status change should be visible and auditable
- avoid decorative hero sections

## Referral Program

Referral should feel like a focused sales tool:

- pick product/service
- create/share link or QR
- see attribution
- see commission state
- send customers into `/chat`

## Anti-Patterns

- Do not design around healthcare unless the task explicitly asks for that vertical.
- Do not use showcase/mockup/concept language on primary routes.
- Do not invent proof, revenue numbers, or channel availability.
- Do not hide backend setup/auth failures behind demo data.
- Do not create separate business logic per channel.
