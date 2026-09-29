# Payment Integrity — project instructions

The full product specification is in `docs/PRODUCT_SPEC.md`. Read it completely before writing any code. This file adds build rules and corrections that take priority over the spec where they differ.

## Build in phases
Finish and polish each phase before starting the next. At the end of each phase, stop and summarise what was built, what was skipped and any open questions. Wait for my go-ahead before continuing.

1. Domain model, deterministic fixtures, repositories, policy engine, plus unit tests.
2. App shell, Overview, Incidents list, Incident workspace.
3. Case list, Case detail, execution state machine, Audit Log.
4. Automations and policies, Outcome Contracts, Integrations.
5. Customer "Check my payment" page, empty/loading/failure/stale states, accessibility pass.

Depth over breadth: a finished, polished Phase 3 beats a thin Phase 5.

## Corrections to the spec

### Business impact on Overview
Add a "Value delivered (trailing 30 days)" section to Overview:
- GMV resolved before refund or dispute
- Avoidable refunds prevented
- Estimated support contacts avoided
- Median time from detection to verified outcome

Each figure links to the cases behind it and has a one-line "How this is calculated" tooltip. Count only cases where the default outcome would have been an auto-refund or a customer contact. No projected or inflated numbers.

### Deploy evidence needs a source
Add an integration: **LearnLoop Observability** (deploy events, service error logs), connected, read-only. Add a `deploy.completed` fixture event for `v2.3` at 14:04 IST so incident evidence can cite a real event ID. The agent may only mention the deployment because this event exists.

### Exact arithmetic
- Build fixture amounts from real course prices (₹999, ₹2,499, ₹3,499, ₹4,999, ₹9,999) so each group sums exactly: 38 safe = ₹1,51,955; 3 duplicate = ₹10,497; 2 high-value = ₹19,998; total ₹1,82,450.
- For duplicate cases, amount at risk = the original payment only. Track the second charge separately as refund exposure.
- Add a test asserting every displayed aggregate equals the sum of its underlying cases, before and after resolving the 38 safe cases (remaining ₹30,495).

### Disclaimer
Put exactly one line in the footer of the admin shell (small, muted): "Concept prototype built on simulated data. Not an official Razorpay product." No other prototype labels in the UI. Use Razorpay's official white wordmark, obtained only from https://razorpay.com/newsroom/brand-assets/ and subject to Razorpay's Usage Agreement, stored at `public/brand/razorpay-wordmark-white.png` and shown at its own aspect ratio. Never redraw, recolour or typeset a substitute logo; until the official file is present, the shell falls back to the plain text "Razorpay".

### Next.js and localStorage
Load persisted state client-side only (after mount), so server and client renders match. The app must have zero hydration warnings or console errors.

## UI system: Razorpay Blade (overrides the spec's Tailwind/shadcn instruction)
- Build the UI with Razorpay's public design system **Blade** (`@razorpay/blade`, MIT licensed). Docs: https://blade.razorpay.com. Follow its official Installation guide exactly for peer dependencies, fonts and `BladeProvider` + theme setup. Do not guess versions.
- Use Blade components and tokens (colour, spacing, typography, radius) everywhere a Blade component exists: tables, buttons, badges, alerts, inputs, modals, drawers, tabs. Only hand-build what Blade doesn't offer, and style it with Blade tokens.
- Blade uses styled-components. In Next.js App Router, set up the styled-components SSR registry and mark Blade-using components as client components. Do not mix in shadcn/ui or Tailwind component styles; drop them from the stack. Keep Recharts only for the two allowed charts, coloured with Blade tokens.
- Use Blade's icons instead of Lucide where Blade has an equivalent.
- If Blade's install fails or a component is missing, stop and tell me. Don't silently switch libraries.

## Skills to use
- **ui-ux-pro-max:** use when planning each screen's layout, information hierarchy, states and interactions, before writing UI code for a phase.
- **ui-styling:** use when implementing and polishing visual details: spacing, alignment, typography scale, table density, states.
- **brand:** use to keep copy, tone and visual identity consistent with Razorpay's product language. Blade tokens are the source of truth for colours and type.
- If a skill's advice conflicts with Blade or with the spec's anti-slop rules, Blade and the spec win. Say what you overrode.
- At the start of each UI phase, state which skills you are applying and how.

## Anti-slop additions
- No placeholder text, lorem ipsum, "Coming soon" or TODO comments in shipped UI.
- No invented features beyond the spec. If something seems missing, ask; don't improvise.
- Every number on screen must come from fixtures or computation, never from hard-coded display strings.

## Engineering rules
- TypeScript strict mode. Business logic lives in `services/`, not in components.
- Run `npm run lint`, `npm run typecheck` and `npm test` at the end of every phase and fix all failures.
- Commit at the end of each phase with a clear message.