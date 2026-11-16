# Image pipeline

Draft. Images are the biggest risk to page speed, so the pipeline does the right thing automatically.

## On upload

Using [sharp](https://sharp.pixelplumbing.com):

1. Check type and size (JPEG, PNG, WebP, AVIF; SVG only for logos and icons, sanitised). Reject anything huge.
2. Auto-rotate from EXIF, then strip metadata (including GPS location).
3. Cap the stored original (for example 3200 pixels on the long edge).
4. Generate renditions at set widths, 320, 640, 960, 1280, 1920 and 2560, in **AVIF** and **WebP**. No JPEG fallback in v1 ([ADR 0013](decisions/0013-renditions-at-upload.md)).
5. Store a tiny blurred placeholder and the dominant colour, to avoid blank boxes while loading.
6. Record width, height and focal point for each media item.

Widths larger than the original are never generated.

## In the page

The renderer outputs a full responsive image, so the browser picks the right file:

```html
<picture>
  <source type="image/avif" srcset="/media/abc-640.avif 640w, /media/abc-1280.avif 1280w, /media/abc-1920.avif 1920w" sizes="100vw">
  <source type="image/webp" srcset="/media/abc-640.webp 640w, /media/abc-1280.webp 1280w, /media/abc-1920.webp 1920w" sizes="100vw">
  <img src="/media/abc-1280.webp" width="1280" height="720" alt="A rescued puppy wrapped in a blanket" loading="lazy" decoding="async">
</picture>
```

- `width` and `height` are always set, so there is no layout shift.
- `sizes` comes from the block definition (a full-width hero is `100vw`, a card in a three-column grid is roughly `33vw`).
- The first large image on a page (usually the hero) is `fetchpriority="high"` and not lazy-loaded. Everything else is lazy.
- Alt text is required unless the image is marked as decorative.

Renditions are made **at upload time** by a background job using sharp, so publishing never waits for image work ([ADR 0013](decisions/0013-renditions-at-upload.md)). Media lives in one shared, append-only folder outside the release folders, so every kept release can still find its images ([ADR 0005](decisions/0005-rollback-and-approval.md)).

## Required sizes and crop approval

Each image slot in a block declares the size it needs. For example the masthead hero needs **1280 x 720** (16:9).

When an upload does not match:

1. The editor shows the image with a **crop rectangle locked to the required aspect ratio**, placed at a sensible default (centre, or the focal point).
2. The user can move and resize the rectangle, but not change its ratio.
3. The user must **approve the crop** before the image is used. No silent cropping.
4. If the image is too small for the slot, the editor warns and suggests a bigger image.
5. The crop is stored as coordinates against the original, so it can be changed later without re-uploading.

The chat agent can pick an image for a slot but cannot approve a crop on someone's behalf. If the crop needs a human, the agent says so.

## Video

For backgrounds such as a near full-screen video hero:

- Short, muted, looping, no audio track.
- Transcoded and compressed hard (for example H.264 and AV1 or VP9, under a few MB), with a poster image from the pipeline above.
- Not loaded on mobile or when the visitor prefers reduced motion or has data saver on, where the poster is shown instead.

Transcoding (ffmpeg) is a later phase. At first, videos may need to be prepared before upload.

## Later: art direction and the crop wizard

Different crops per breakpoint (for example a wide 16:9 crop on desktop and a tall 4:5 crop on mobile) need a **crop wizard** that walks through each breakpoint's crop in turn. This is a later phase. The data model should leave room for it now: store crops as a list keyed by breakpoint, even if only one is used at first.

## Open questions

- Exact quality settings for AVIF and WebP (to tune in the spike against the budgets in [17-testing-and-budgets.md](17-testing-and-budgets.md)).
- Optional object storage for media (for example Cloudflare R2) after v1. v1 is local disk, backed up off-site ([16-operations.md](16-operations.md#backups-and-restore)).
