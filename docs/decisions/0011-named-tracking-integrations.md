# 0011: Tracking through named integrations, not a raw script slot

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

The feature inventory had an admin "slot for site-wide head and body snippets". That is arbitrary script on every page, which contradicts "no arbitrary custom code" and bypasses the embed allow-list and the Content Security Policy.

## Decision

- No raw snippet slot. Tracking and consent are **named integrations** configured by id in Settings > Tracking and consent: Google Analytics 4, Google Tag Manager, Plausible, and Cookiebot to start with.
- Each integration knows its domains, so the Content Security Policy and the embed allow-list are generated from it.
- Tracking scripts wait for consent: with Cookiebot, Google Consent Mode defaults to "denied" until the visitor agrees.
- **Google Tag Manager is the one deliberate escape hatch**: it can load other scripts. It is admin-only, changes go through approval, and the docs say plainly that it widens what can run on the site.

## Consequences

- AAU's existing Cookiebot and analytics carry over by id.
- New tracking tools need a small code change to add an integration. That is intended.
