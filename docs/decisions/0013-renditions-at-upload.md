# 0013: Image renditions are made at upload time with sharp

- **Status:** Accepted
- **Date:** 2026-11-17

## Context

Renditions could be made at upload time (sharp directly) or at generate time (Nuxt Image with IPX).

## Decision

Renditions are made **at upload time** by a `media_renditions` job using sharp: AVIF and WebP at 320, 640, 960, 1280, 1920 and 2560 pixels (never larger than the original), plus a blurred placeholder and dominant colour. No JPEG fallback in v1 (every browser AAU's visitors use supports WebP). Crops are applied as extra renditions keyed by slot ratio when a crop is approved.

## Consequences

- Publishing never waits for image work, which keeps it fast (ADR 0004).
- Disk use is higher (about 12 files per image), which is fine on local disk.
