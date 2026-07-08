---
name: mobile-responsive-ux
description: >-
  Best practices plus a real-browser verification workflow for making web apps
  (especially Streamlit) work well on phones and iPads. Use when adapting a UI for
  mobile/tablet, fixing responsive issues (navigation, sidebar/drawer, data tables,
  tap targets, horizontal overflow), or auditing pages at device widths. Covers
  navigation patterns (bottom nav vs hamburger vs horizontal sub-nav), 44px tap
  targets, the drawer pattern, responsive data tables, progressive disclosure, and
  Streamlit-specific gotchas — verified with Selenium device emulation.
---

# Mobile-responsive web app UX

A field guide for making a desktop-first web app good on phones and tablets. The
research is general; the "Streamlit" section captures hard-won gotchas from adapting
a fixed-header + sidebar Streamlit dashboard. **Always verify on real device widths
with Selenium (see the workflow at the end) — do not eyeball responsiveness.**

## Breakpoints to test (the ones that actually matter)

| Device | CSS width | Notes |
|--------|-----------|-------|
| Phone (iPhone) | **390 × 844** | thumb-first, one-hand; nav must collapse |
| iPad portrait | **768 × 1024** | the classic desktop/mobile boundary — decide which side 768 falls on |
| iPad landscape | **1024 × 768** | treat as small desktop |

Pick a single breakpoint (e.g. **767px**) as the phone/tablet divider and be explicit
about which side an exact width lands on (`max-width: 767px` = phone; `min-width: 768px`
= tablet/desktop). iPad portrait at exactly 768 should get the *desktop* treatment.

## Core principles (from market research, 2025–2026)

1. **Navigation: 3–5 primary destinations, not 10.** Bottom tab bars are the mobile
   gold standard for 3–5 sections (thumb zone = bottom third; 49% of users navigate
   one-thumbed). For content-heavy apps, use a **hybrid**: 3–4 persistent items +
   a hamburger/drawer for the rest. **Hidden menus cut task completion ~21%** (NN/g),
   so never bury *critical* actions — and a horizontally-scrolling row of 10 links is
   a hidden-menu anti-pattern (offscreen items get missed).
2. **On mobile, secondary nav is a drawer behind a toggle** — a slide-over with a
   backdrop and an obvious open/close affordance. It must never permanently cover
   content. On tablet/desktop the same nav expands inline (sticky sidebar). Navigation
   is *secondary to content* on mobile.
3. **Tap targets ≥ 44×44px (iOS) / 48×48dp (Android), with ≥ 8px spacing.** Extend
   hit areas with padding. This is the single highest-ROI mobile fix.
4. **Data tables are the hardest responsive problem.** They don't collapse naturally.
   Options, best → acceptable: convert rows to **card stacks**; **sticky header +
   fixed first column** + horizontal scroll inside the table's own box; last resort,
   plain horizontal scroll (but keep a **visible** scrollbar so users know to scroll).
5. **Progressive disclosure + KPI triage.** Show only the most critical KPIs/actions
   on small screens; push detail behind accordions, tabs, drawers, modals.
6. **Design responsive *components*, not page layouts.** Each component (nav, card,
   table, chart) should adapt independently; container queries where available.
7. **No page-level horizontal scroll, ever.** `html, body { overflow-x: hidden }`,
   avoid `100vw` (it includes the scrollbar), and let wide content scroll inside its
   own `overflow-x:auto` container.
8. **Compact the brand on phones** (icon-only or shrunk wordmark) to reclaim nav room.
9. **Thumb zone**: put the most-used actions in the bottom third / bottom corners.

## Concrete checklist for adapting a page

- [ ] No horizontal page scroll at 390 / 768 / 1024 (`scrollWidth == clientWidth`).
- [ ] Primary nav collapses on phone; primary actions still reachable in ≤1 tap.
- [ ] Secondary nav is a drawer or an inline sub-bar that does **not** cover content.
- [ ] Buttons/links ≥ 44px tall on phone; adequate spacing.
- [ ] Brand compacted on phone.
- [ ] Multi-column card rows wrap (e.g. 4-up → 2-up) instead of squishing.
- [ ] Wide tables scroll inside their box with a visible scrollbar (or become cards).
- [ ] Fixed/sticky headers: content below them is offset so nothing is clipped.
- [ ] Hero/section spacing tightened so key content is above the fold.

## Streamlit-specific patterns & gotchas

Streamlit's DOM is emotion-classed and shifts between versions — target `data-testid`s
and re-verify after upgrades. Learnings from a fixed-header + sidebar app (Streamlit
1.52):

- **Fixed header, not sticky.** `position: sticky` fails because 1.52 wraps each block
  in a tight `stLayoutWrapper` (the sticky element's containing block is only its own
  height). Use `position: fixed; top/left/right:0; height: var(--nav-h)` and push the
  app down with `padding-top: var(--nav-h)` on `[data-testid="stAppViewContainer"]`.
- **Full-width bar + centered content**: give the bar `width:100%` (full viewport) but
  cap `.block-container` at a `--content-max` and center it. Don't cap the nav row —
  10 links need the room.
- **The sidebar collapse is unreliable**: after a collapse, Streamlit often fails to
  create a reopen control, stranding the user. On desktop, hide the collapse button
  (`[data-testid="stSidebarCollapseButton"]{display:none}`) and force it open
  (`[data-testid="stSidebar"]:has(.stButton){transform:none!important;width:240px!important}`).
- **On mobile, don't use the drawer** for critical nav (no reliable toggle). Instead
  turn the sidebar into a **fixed horizontal sub-bar** pinned under the header:
  ```css
  @media (max-width: 767px) {
    [data-testid="stSidebar"]:has(.stButton){
      position:fixed!important; top:var(--nav-h)!important; left:0!important; right:0!important;
      width:100%!important; height:auto!important; transform:none!important; z-index:900!important;
    }
    /* lay its items in one swipeable row */
    [data-testid="stSidebar"] [data-testid="stSidebarUserContent"] [data-testid="stVerticalBlock"]{
      flex-direction:row!important; flex-wrap:nowrap!important; overflow-x:auto!important; align-items:center!important;
    }
  }
  ```
- **`stMain` is `position:absolute; inset:0` on mobile** (it's the scroll container),
  so the app-container's `padding-top` offset is **ignored**. Clear the fixed header by
  padding the block-container directly, in the mobile media query:
  `[data-testid="stMainBlockContainer"]{ padding-top: calc(var(--nav-h) + 0.6rem) !important }`,
  and reserve extra room on pages that also show the sub-bar
  (`...:has([data-testid="stSidebar"] .stButton) [data-testid="stMainBlockContainer"]{ padding-top: calc(var(--nav-h) + 3.1rem) }`).
- **`initial_sidebar_state="auto"`** collapses on mobile, expands on desktop.
- **Dataframes**: hide the spurious *vertical* scrollbar but keep a slim *horizontal*
  one so wide tables reach their last column
  (`::-webkit-scrollbar:vertical{width:0} ::-webkit-scrollbar:horizontal{height:10px}`).
  Don't set `scrollbar-width:none` in Chromium — it defeats the `::-webkit` rules.
- **`:has()` is your friend** for conditional layout ("only when the sidebar holds
  buttons", "only the column containing X") — supported in Edge/Chrome/Safari.
- Streamlit columns don't reliably auto-stack; force wrap for card rows:
  `[data-testid="stHorizontalBlock"]{flex-wrap:wrap} [data-testid="stColumn"]{flex:1 1 46%;min-width:46%}`.

## Verification workflow (Selenium device emulation)

Selenium (headless Edge/Chrome) with `mobileEmulation` is the reliable way to check
responsiveness. Boot the app headless, then:

```python
from selenium import webdriver
from selenium.webdriver.edge.options import Options
o = Options(); o.add_argument("--headless=new")
o.add_experimental_option("mobileEmulation", {
    "deviceMetrics": {"width": 390, "height": 844, "pixelRatio": 2.0, "mobile": True},
    "userAgent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) ... Mobile"})
d = webdriver.Edge(options=o); d.get("http://localhost:8599"); time.sleep(9)

# 1) no horizontal overflow
d.execute_script("const e=document.documentElement; return e.scrollWidth>e.clientWidth+1;")  # -> False
# 2) measure geometry: getBoundingClientRect() for header, sidebar, block-container
# 3) d.save_screenshot(...) and actually look at it
```

Assertions worth making at each width: page `scrollWidth == clientWidth`; the nav/rail
`position` and `width` are what you expect (fixed sub-bar on phone, relative 240px rail
on tablet); the first content element's `top` is **below** the fixed header (+ sub-bar);
tap targets ≥ 44px. Screenshot Home + a data page + a page that shows the secondary nav.

Caveat: data-backed pages can be empty in a sandbox without network — measure on the
page you actually care about, and click nav buttons by visible text to navigate.

## Sources

- [Mobile Navigation UX Best Practices, Patterns & Examples (2026) — DesignStudio](https://www.designstudiouiux.com/blog/mobile-navigation-ux/)
- [The Complete Guide to User-Friendly Mobile Navigation in 2025 — DEV](https://dev.to/secuodsoft/the-complete-guide-to-creating-user-friendly-mobile-navigation-in-2025-4l8b)
- [Mobile App Navigation Design: 2026 UX Best Practices — Medium/UI-UX Trends](https://medium.com/ui-ux-designing-trends/mobile-app-navigation-design-2026-ux-best-practices-5b2db901790d)
- [Mobile Navigation Design: 8 Types, Examples & Best Practices — UXPin](https://www.uxpin.com/studio/blog/mobile-navigation-examples/)
- [Mobile Menu Design: Best Practices (2025) — Webstacks](https://www.webstacks.com/blog/mobile-menu-design)
- [Admin Dashboard UI/UX: Best Practices for 2025 — Medium](https://carlossmith24.medium.com/admin-dashboard-ui-ux-best-practices-for-2025-8bdc6090c57d)
- [Responsive Design: Best Practices & Examples [2025] — UXPin](https://www.uxpin.com/studio/blog/best-practices-examples-of-excellent-responsive-design/)
- [Designing an Intuitive Mobile Dashboard UI — Toptal](https://www.toptal.com/designers/dashboard-design/mobile-dashboard-ui)
- [Handling Fixed and Sticky Elements in Responsive Layouts — Medium](https://medium.com/@Adekola_Olawale/handling-fixed-and-sticky-elements-in-responsive-layouts-7a79a70a014b)
