---
version: alpha
name: Baton
description: Notion-inspired design system for a remote AI agent orchestration platform. Warm minimalism, subtle surfaces, and engineering precision.
colors:
  surface-0: "#ffffff"
  surface-50: "#fafaf9"
  surface-100: "#f5f5f4"
  surface-200: "#e7e5e4"
  surface-300: "#d6d3d1"
  surface-400: "#a8a29e"
  surface-500: "#78716c"
  surface-600: "#57534e"
  surface-700: "#44403c"
  surface-800: "#292524"
  surface-900: "#1c1917"
  surface-950: "#0c0a09"
  primary: "#2383e2"
  primary-50: "#eff6ff"
  primary-100: "#dbeafe"
  primary-200: "#bfdbfe"
  primary-300: "#93c5fd"
  primary-400: "#60a5fa"
  primary-500: "#2383e2"
  primary-600: "#1d4ed8"
  primary-700: "#1e40af"
  primary-800: "#1e3a8a"
  success: "#16a34a"
  success-50: "#f0fdf4"
  success-100: "#dcfce7"
  success-400: "#22c55e"
  success-500: "#16a34a"
  success-600: "#15803d"
  warning: "#d97706"
  warning-50: "#fffbeb"
  warning-100: "#fef3c7"
  warning-400: "#f59e0b"
  warning-500: "#d97706"
  warning-600: "#b45309"
  danger: "#ef4444"
  danger-50: "#fef2f2"
  danger-100: "#fee2e2"
  danger-400: "#f87171"
  danger-500: "#ef4444"
  danger-600: "#dc2626"
  danger-700: "#b91c1c"
  terminal-bg-light: "#fafaf9"
  terminal-fg-light: "#1c1917"
  terminal-bg-dark: "#191919"
  terminal-fg-dark: "#e8e8e8"
typography:
  h1:
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 600
    lineHeight: 1.3
  h2:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.35
  h3:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.4
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.4
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1
    letterSpacing: 0.1em
  mono:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.6
  mono-sm:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.5
  terminal:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.4
rounded:
  none: 0px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  2xl: 32px
  3xl: 48px
  sidebar: 240px
components:
  card:
    backgroundColor: "{colors.surface-0}"
    rounded: "{rounded.lg}"
    padding: 16px
  card-dark:
    backgroundColor: "{colors.surface-900}"
  card-bordered:
    backgroundColor: "{colors.surface-0}"
    rounded: "{rounded.lg}"
  button-primary:
    backgroundColor: "{colors.primary-500}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: 8px
  button-outline:
    backgroundColor: transparent
    textColor: "{colors.surface-700}"
    rounded: "{rounded.md}"
    padding: 8px
  button-danger:
    backgroundColor: "{colors.danger-500}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: 8px
  input:
    backgroundColor: "{colors.surface-50}"
    textColor: "{colors.surface-900}"
    rounded: "{rounded.md}"
    padding: 8px
  chip:
    rounded: "{rounded.full}"
    padding: 4px
  chip-success:
    backgroundColor: "{colors.success-50}"
    textColor: "{colors.success-600}"
  chip-danger:
    backgroundColor: "{colors.danger-50}"
    textColor: "{colors.danger-600}"
  chip-primary:
    backgroundColor: "{colors.primary-50}"
    textColor: "{colors.primary-600}"
  terminal:
    backgroundColor: "{colors.terminal-bg-light}"
    textColor: "{colors.terminal-fg-light}"
    rounded: "{rounded.lg}"
  terminal-dark:
    backgroundColor: "{colors.terminal-bg-dark}"
    textColor: "{colors.terminal-fg-dark}"
  stat-card:
    rounded: "{rounded.lg}"
    padding: 20px
  file-row:
    rounded: "{rounded.lg}"
    padding: 10px
  event-row:
    rounded: 0px
    padding: 8px
  nav-item:
    rounded: "{rounded.xl}"
    padding: 8px
---

## Overview

Baton is a remote AI agent orchestration platform. The UI follows a **Notion-inspired minimal aesthetic** — warm stone surfaces, generous whitespace, and subtle depth through tonal layers rather than heavy shadows.

The design philosophy is **calm engineering**: the interface should feel like a clean desk, not a cockpit. Information is grouped into bordered cards with soft backgrounds. Interactive elements use a single blue accent. Status is communicated through small colored dots and chips, not loud banners.

**Dark mode** is a first-class citizen. The dark palette uses near-black stone tones with the same blue accent, maintaining the same visual hierarchy through tonal inversion.

## Colors

The palette is built on a **warm stone scale** (surface-0 through surface-950) with a **Notion blue** primary and semantic colors for status feedback.

- **Surface scale (#ffffff → #0c0a09):** Warm stone grays providing the tonal foundation. Light mode uses surface-50 as page background; dark mode uses surface-950.
- **Primary (#2383e2):** Notion blue — the single accent for interactive elements, links, active states, and brand identity.
- **Success (#16a34a):** Green for online status, completed states, and positive feedback.
- **Warning (#d97706):** Amber for waiting states and caution indicators.
- **Danger (#ef4444):** Red for errors, stopped agents, and destructive actions.

Light mode: white cards on warm off-white (#fafaf9) background with stone borders (#e7e5e4).
Dark mode: dark cards (#1c1917) on near-black (#0c0a09) background with dark borders (#44403c).

## Typography

Two font families form the typographic system:

- **Inter** — All UI text. Humanist sans-serif optimized for screen reading. Weights: 400 (body), 500 (labels), 600 (headings).
- **JetBrains Mono** — All code, paths, session IDs, terminal content, and monospace data. Weights: 400 (regular), 500 (emphasis).

The type scale is compact. H1 is 24px (used sparingly), body is 14px, and monospace is 12-13px. Labels and metadata use 11-12px with tight tracking or uppercase+wide-tracking for section headers.

## Layout

A **fixed sidebar + fluid content** layout. The sidebar is 260px wide with a navigation list and status bar. Content area has max-width 1440px centered with generous padding (24-40px).

Spacing follows a **4px base unit** scale:
- Micro gaps: 4px (between inline elements)
- Component internal: 8-12px (padding inside chips, small cards)
- Component spacing: 16px (between sections, card padding)
- Section spacing: 24-32px (between major page sections)
- Page margins: 24-40px

The sidebar uses a navigation pattern with rounded-xl active indicators and a 3px left accent bar on the active item.

## Elevation & Depth

Depth is achieved through **tonal layers and borders**, not shadows. The hierarchy is:

1. **Page background** — surface-50 (light) / surface-950 (dark)
2. **Cards and panels** — white (light) / surface-900 (dark) with 1px border
3. **Sidebar** — white with 80% opacity + backdrop blur (light) / surface-950 with 80% opacity + backdrop blur (dark)
4. **Header** — white with 80% opacity + backdrop blur, fixed on mobile

Shadows are used sparingly — only for the sidebar brand mark (shadow-sm with primary color) and focused buttons. Scrollbars are minimal (8px, transparent track, rounded thumb).

## Shapes

All shapes use **subtle rounding** following Notion's approach:

- **4px (sm):** Small elements — status dots, inline code badges, small chips
- **6px (md):** Inputs, buttons, form controls
- **8px (lg):** Cards, file rows, stat cards, connection panels, all major containers
- **12px (xl):** Navigation items, large interactive areas
- **Full (9999px):** Pills, badges, status indicators, chip components

Never use rounded corners above 12px for standard containers. The design is intentionally restrained — architectural sharpness with just enough softness to feel modern.

## Components

### Cards
White/surface-900 background with 1px border. 8px border-radius. Padding varies: 16px for standard, 20px for stat cards. Hover adds subtle background shift. Left border accent (4px colored bar) for stat cards.

### Buttons
Three variants: primary (blue bg, white text), outline (transparent bg, bordered), danger (red bg). All use 6px radius. Size sm uses compact padding. Ghost variant for icon-only buttons.

### Chips (Status Indicators)
Pill-shaped (full radius). Three semantic colors: success (green), danger (red), primary (blue). Soft variant with light background + darker text. Used for connection status, agent status, file change types.

### Terminal
Full-height xterm.js container with 8px radius and 1px border. Font: JetBrains Mono 13px with 10000 scrollback. Light/dark themes defined with 16 ANSI colors matching the surface palette.

### File Browser
Split-pane layout: file tree (left) + code preview (right, 55%). File rows are full-width buttons with 8px radius, icon + name + size. Code preview uses monospace with 16px padding on surface-50 background.

### Navigation
Sidebar nav items use 12px rounded-xl with 3px left accent bar when active. Icons are 18px SVGs. Active state uses primary-50 background. Mobile shows hamburger menu with slide-in overlay.

## Do's and Don'ts

- Do use `rounded-lg` (8px) for cards — never exceed 12px border-radius on containers
- Do maintain WCAG AA contrast ratios for all text on backgrounds
- Do use the surface scale for depth — lighter surfaces for elevated content
- Do use JetBrains Mono for all code, paths, and session IDs
- Don't mix rounded corner scales — stay within the 4px/6px/8px/12px system
- Don't use shadows for elevation — use tonal layers and borders instead
- Don't use more than two font weights on a single screen
- Don't use decorative glass effects or excessive backdrop blur — the sidebar blur is the only exception
- Don't apply padding below 8px on text containers — text must always breathe
- Don't use primary blue for decorative elements — reserve it for interactive and active states
