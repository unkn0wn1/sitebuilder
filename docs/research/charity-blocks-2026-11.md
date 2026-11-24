# Charity page blocks: what to add next

- **Date:** 17 November 2026
- **Status:** Research only. No product or AAU site changes in this note.
- **Why:** Spencer asked what to add to the “Add section” palette, and pointed at the Virtuous Raise Experience at [give.animalaidunlimited.org/donate/giving-tuesday-2026](https://give.animalaidunlimited.org/donate/giving-tuesday-2026). He liked some touches, was unsure about the Charity Navigator area being all red, and felt it looked “straight out of WordPress”. He would rather embed Virtuous forms on AAU’s own site than send people to Raise Experiences.

This note lists the current starter blocks, reviews that Giving Tuesday page, looks at nine other well-regarded charity and campaign pages, and ranks new blocks to add. It also names four to build first.

## Current starter blocks

From `shared/blocks/library.ts` (the Add section palette). Thirteen types:

| Block | Label | What it is for | Key fields |
| --- | --- | --- | --- |
| `Hero` | Hero | A big opening with a photo and a button | Heading, subheading, image, optional CTA, tone |
| `VideoHero` | Video hero | The same opening, with a muted looping video | Heading, subheading, poster, video, optional CTA, tone |
| `RichText` | Text | A body of structured rich text | Content |
| `TextAndImage` | Text and image | A story or explanation beside a photo | Heading, content, image, image left or right |
| `Image` | Image | A single photo | Image, caption |
| `Gallery` | Gallery | A grid of photos (not a carousel) | Heading, 2–24 images |
| `Quote` | Quote | A short testimonial line | Text, attribution |
| `Stats` | Numbers | Up to four headline figures | Optional heading, value + label |
| `CardGrid` | Cards | A grid of titled cards, optionally with a photo and link | Heading, title, text, optional image and link |
| `CallToAction` | Call to action | A single closing ask | Heading, text, button, tone |
| `FAQ` | Questions and answers | An accordion of questions | Heading, question + rich answer |
| `DonationEmbed` | Donation form | A registered Virtuous (or similar) form, with a `#donate` anchor | Embed, heading, anchor |
| `Embed` | Embed (video, map, form) | Any other allow-listed embed | Embed, title |

The Header site part already has an optional Donate button. That is site-wide chrome, not a page block. Cost caps, FAQs, quotes, stats, galleries and video heroes are already in the palette, so this note does not propose them as new types. A few could be *extended* later (a photo on a quote, a carousel option on a gallery).

The original block-model draft also mentioned a standalone `Video` block. That never landed; `VideoHero` plus `Embed` cover most cases.

## The Giving Tuesday Raise page

Public URL: [https://give.animalaidunlimited.org/donate/giving-tuesday-2026](https://give.animalaidunlimited.org/donate/giving-tuesday-2026). It is a Virtuous Raise Experience (RaiseDonors), not a page on animalaidunlimited.org. The shell is a thin HTML page that loads `cdn.virtuousraise.org/embed/embed.js`. The layout below is from the public page configuration, looked at on 17 November 2026. No payment or account details are recorded here.

### What the page is made of

In order:

1. **Hero (“spotlight”).** Eyebrow “Giving Tuesday · December 1”. Headline “Help injured animals heal today.” A clear subhead about urgent care and a second chance. Photo, “Give now” jumping to `#donate`, and a small stat: “1 day to make twice the impact.” Soft red wash behind it (`#FCE0E0`).
2. **Trust bar.** “Give with confidence.” Four credentials: Charity Navigator Four-Star, Candid Platinum, TripAdvisor, and 501(c)(3) status, plus a claim that 92% of every dollar reaches programmes, and a security line (secure giving, tax-deductible, email receipt).
3. **Story (two columns).** “A real rescue, not a statistic.” A specific emergency-to-recovery narrative, a pull quote, and a photo. This is the strongest writing on the page.
4. **Donation block.** “Give today to help the next rescue.” One-time or recurring (recurring is an opt-in checkbox, not pre-ticked). Amounts $25, $50, $100, $250, plus a custom amount. A campaign goal of $250,000 (12 Nov–13 Dec 2026). Recent gifts can be shown. The form steps through amount, details, payment, optional fee cover, then confirmation. Minimum gift $5.
5. **Charts.** “Where your gift goes”: emergency rescue 35%, medical treatment 40%, food and recovery 25%, with a centre label “100% focused on animals in need.”
6. **Closer.** A thank-you line, share, and secondary links (updates, volunteer, other campaigns).

Prompts after the form (typical Raise behaviour, not page sections): ask to make it recurring, ask to cover processing fees, and a “you didn’t finish” message if the gift is abandoned.

Brand tokens on the Experience: primary and buttons `#E90000`, hover `#BA0000`, secondary `#FF9517`, body text `#2A2A2A`, Lato, 10px corner radius. Header chrome is white with dark text; the redness comes from the primary colour, the hero wash, links and buttons.

### Touches worth borrowing

- A dated eyebrow and a *specific* headline. “Help injured animals heal today” is better than a generic “Support our cause.”
- One primary button that jumps to a named donate anchor. That pattern already fits `DonationEmbed`.
- A short urgency chip on the hero (“1 day… twice the impact”). This is a match or countdown, even if the copy is a little generic.
- A real rescue story with a pull quote, not only statistics.
- A simple “where your gift goes” breakdown next to the form. Donors who are ready still like to see the split.
- One-time and monthly on the same form, with monthly as an invitation rather than a default trap. (Some UK pages do pre-select monthly; that is a policy choice.)
- A fee-cover ask *after* the gift amount is chosen, not before.
- A quiet closer with share and a next step (updates, volunteer), so the page does not die after the form.

### Bits to avoid

- **It reads as a template.** Two credentials still have the placeholder “Describe this credential.” The form’s social image still points at Raise’s default `rd-base-meta-image`. Those leftovers are what make it feel “straight out of WordPress,” even though it is not WordPress.
- **The Charity Navigator / trust strip is overstyled and mixed.** Charity Navigator, Candid, TripAdvisor and 501(c)(3) are treated as the same kind of badge. TripAdvisor is a visitor review site, not a charity regulator. With primary set to a hard `#E90000`, that whole bar can feel like one red slab of seals. Trust marks work better as a quiet logo row, in the organisation’s own colours, with only the credentials that are real and explained.
- **Gift amounts have no impact line.** $25 / $50 / $100 / $250 are bare numbers. Battersea and IFAW almost always attach “£25 could…” copy. That is the biggest miss on an otherwise careful page.
- **The $250,000 goal and “twice the impact” chip are disconnected.** The campaign has a goal and dates, but the match label is empty, so the hero stat is not tied to a visible thermometer or a named match.
- **Generic meta description** (“Support our cause by making a donation today…”) rather than the page’s own headline.
- **Hosting this as a Raise Experience** takes people off AAU’s site, typography and header. The good sections (story, split, urgency) can live on a Skewstone campaign page with a Virtuous *form* embedded, which is what Spencer prefers.

Spencer’s instinct is right: keep the story, the clear ask and the confidence signals; drop the red badge wall and the unedited template chrome; put the form on AAU’s own pages.

## Recurring patterns on other sites

Looked at on 17 November 2026 (public pages, not accounts):

| Site | URL | Patterns that show up again and again |
| --- | --- | --- |
| charity: water | [charitywater.org/donate](https://www.charitywater.org/donate) | A short, confident ask; 100% / transparency as a trust section; monthly community (“The Spring”); a large “sponsor a project” tier; honour, legacy and other ways to give, not only the card form. Their wider site is known for campaign progress and photo-led stories. |
| Battersea | [donate.battersea.org.uk/appeals/default](https://donate.battersea.org.uk/appeals/default) | A named animal in the hero; **impact tiers** for one-off and monthly amounts (“£50 could give one animal warmth, safety and shelter for a day”); a second story on appeal pages (Dash, Clove); other ways to give. |
| RSPCA | [rspca.org.uk/donate](https://www.rspca.org.uk/donate) | Monthly as the lead ask; a “ways to give” set; a spend split (80p rescue and care); a scale stat (nearly a million calls). Their direct donate flow is often cited for amount-linked impact copy and a CTA that repeats the chosen amount. |
| Dogs Trust | [dogstrust.org.uk/support-us/ways-to-give](https://www.dogstrust.org.uk/support-us/ways-to-give) and the Lifeline appeal | Outcome numbers (dogs cared for / rehomed); a pence-in-the-pound split (72p / 27p / 1p); a long named-dog story (Alfie) on the campaign page; monthly and other ways to give. |
| Best Friends | [bestfriends.org/donate](https://bestfriends.org/donate) | A direct form for people who are ready, and a long landing page for people who are not (their own advice). Monthly named programme (Guardian Angels); honour/memorial; **triple match until a date**; spend FAQ (87% programmes); logo-like recognition; many gift types. |
| IFAW | [donate.ifaw.org/en-gb/animalrescue](https://donate.ifaw.org/en-gb/animalrescue) | Urgency (“every minute counts”); **monthly impact tiers** (£3 milk, £5 care, £8 evacuation, £10 search and rescue); one long rescue story (Yuna) with a before-and-after arc; a short impact/stats band. |
| Humane World for Animals | [donate.humaneworld.org/page/160655/donate/1](https://donate.humaneworld.org/page/160655/donate/1) | Photo hero and a compact form; one-time / monthly toggle; **challenge or match fund** (“add my gift to the Challenge Fund”); fee cover; employer match. Amounts are bare ($35–$1,000), like the Raise page. |
| Campaign platforms (Givebutter, Classy, GoFundMe, JustGiving) | Platform conventions, plus Battersea’s own JustGiving guidance | **Goal thermometer**, recent gifts, a story + photos or video, a deadline, share, organizer or team, updates (a timeline), and a **sticky donate control**. Pages with a target and a personal story raise more than pages without, which is why these sections keep appearing. |
| Best Friends (giving experience guidance) | [bestfriends.org/network/resources-tools/creating-compelling-website-giving-experience](https://bestfriends.org/network/resources-tools/creating-compelling-website-giving-experience) | First impression; the problem in plain words; the donor as the solution; a large donate button; inspirational stories that point back to the form; “who we are” for people who landed cold. |

What repeats, in short:

- Impact tied to an amount, not only a number pad.
- One animal or community story, often with a before and after.
- A progress or match device when there is a campaign.
- A trust or transparency band (spend split, regulator marks, 100% claims) that stays calm.
- A form that is either on the page or one click away, with a button that never disappears.
- Monthly giving as a named programme, plus “other ways to give” for people who will not use the card form.

## Ranked shortlist of new blocks

Twelve candidates, new types only. “Pairs with Virtuous” means the block should sit on the same page as `DonationEmbed` and send people to `#donate` (or a chosen anchor). It should not try to replace the form. Live totals or amount pre-fills from Virtuous would be a later, larger piece of work; v1 of each block should work with editor-entered copy.

| Rank | Block | Purpose | Key fields | Virtuous embed | Effort | Inspired by |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Impact tiers** | Show what ₹500 / £25 / $50 actually does, and let the donor pick a tier. | Heading, intro, list of amount, title, short explanation, optional image; optional “other amount”; CTA to the donate anchor. Currency as plain text so INR and GBP stay first-class. | Yes. The block is the explanation; the embed takes the payment. Do not promise that tapping a tier will pre-fill Virtuous until that is proven. | S | Battersea, IFAW, RSPCA, Dogs Trust. The Giving Tuesday page is weaker for not having this. |
| 2 | **Donation progress** | Show how far a campaign is towards a goal. | Heading, goal amount, amount raised (editor-entered in v1), optional label (“raised so far”), optional end date, optional match line, CTA. | Yes. Place it just above the form. A later “live from Virtuous” mode would be L; ship manual figures first. | M | Givebutter, Classy, GoFundMe, JustGiving, charity: water campaigns, the unused $250,000 goal on the Raise page. |
| 3 | **Match or countdown banner** | A short, urgent strip: a deadline, a match, or both. | Message, optional end date (countdown), optional match line (“gifts doubled until Tuesday”), tone, CTA to the donate anchor, option to hide when the date has passed. | Yes. This is the thing that should sit under the hero and above the form on a Giving Tuesday page. | S | Giving Tuesday hero chip; Humane World challenge fund; Best Friends “triple-matched until 31 December 2026.” |
| 4 | **Story with before and after** | Tell one rescue properly, with two photos. | Eyebrow, heading, rich body, pull quote, optional attribution, before image + caption, after image + caption, optional CTA. | Yes, a CTA back to `#donate`. One story per block; stack two if needed. | M | IFAW (Yuna), Dogs Trust (Alfie), Battersea appeal stories, the Raise story module (which only has one image). |
| 5 | **Where your gift goes** | A simple spend breakdown, not four raw stats. | Heading, intro, 2–6 slices (label, percent or amount, optional note), optional centre or footnote (“of every £1”). | Yes, beside or just below the form. | S | Raise charts module; Dogs Trust 72p; RSPCA 80p; Best Friends 87% FAQ. Different from `Stats`. |
| 6 | **Trust or partner strip** | Quiet proof: logos and short labels, not a red wall of seals. | Heading, optional intro, 2–8 items (logo, name, optional short note or link). No auto-tinted backgrounds. | Loosely. Works above the form, or in a footer-like band. | S | charity: water partners; Best Friends recognition; the Raise trust bar (as a warning of what not to do). |
| 7 | **Sticky donate bar** | Keep a compact ask on screen while people read. | Label, button (link to `#donate` or a page), optional progress snippet, show after the hero, hide when the form is in view. Needs a little public JS (`clientJs`). | Yes. This is how a long story page still converts. | M | Almost every campaign platform; Best Friends’ “don’t make qualified donors hunt.” Complements the Header donate button rather than replacing it. |
| 8 | **Photo testimonial** | A quote with a face and a role, stronger than the current `Quote` line. | Quote, name, role or organisation, optional photo, optional link. Allow 1–3 items. | Loosely. | S | Charity landing pages generally; the Raise pull quote would be better with a real person. Could instead be a `Quote` v2; a new block is cleaner for the palette. |
| 9 | **Timeline** | A rescue-to-recovery path, or dated campaign updates. | Heading, items (date or step, title, short text, optional image). | Loosely, with a CTA at the end. | M | GoFundMe/Classy updates; Battersea “journey”; AAU’s own intake-to-release stories. |
| 10 | **Newsletter signup** | Collect updates without building a native mail service. | Heading, text, and either a registered embed or a button to an external signup. | Possible if the signup is a Virtuous (or similar) form; otherwise `Embed`. | S if it wraps an embed; M if it posts somewhere new (not recommended in v1). | Raise closer “Sign up for updates”; almost every charity footer. |
| 11 | **Locations** | Show a hospital, centres or field sites. | Heading, list of name, address, optional hours, optional photo; optional map embed. | No, except a “support this centre” CTA. | M | Battersea and Dogs Trust multi-centre sites; IFAW’s country footprint; AAU in Udaipur. `Embed` can already do a single map. |
| 12 | **Team or volunteer cards** | Faces and roles for a “who you’ll be helping with” band. | Heading, cards (photo, name, role, short bio). | No. | S | A specialised `CardGrid`. Useful on About pages, less so on a tight campaign page. |

### Already in the palette (do not add as new types)

- Video hero, FAQ, Numbers, Gallery, Quote, Cards, Call to action, Donation form, generic Embed.
- Useful later *enhancements*, not first-batch types: optional carousel on Gallery; optional count-up on Stats; a Header/sticky relationship so the donate button and the sticky bar do not both shout.

## First batch: the top four

Build these first, in this order:

1. **Impact tiers (S).** This is the gap on the Giving Tuesday page and the pattern every strong animal-welfare donate page uses. It is small, obviously useful next to a Virtuous form, and works in rupees as easily as in pounds.
2. **Donation progress (M, manual totals).** Campaign pages need a goal people can see. Manual figures keep the first version honest and static-friendly. Live Virtuous totals can wait.
3. **Match or countdown banner (S).** Giving Tuesday, matches and “until midnight” appeals are already in AAU’s calendar. A small, reusable strip will get used immediately.
4. **Story with before and after (M).** This is AAU’s natural content — intake and recovery photos — and `TextAndImage` only has one picture. It is the section Spencer already responded to on the Raise page.

Together they let a campaign page do: urgency, proof of what a gift buys, a visible goal, one real animal, and the existing Virtuous form. Trust strip and “where your gift goes” are the next two if the batch goes well; both are small.

## Notes for later

- Prefer blocks that render as static HTML. The sticky bar is the only first-batch item that really needs public JavaScript; progress and countdown can render the state at publish time (and hide or freeze once a date has passed).
- Do not try to restyle Virtuous’s own form internals. Surround it with AAU typography and these sections instead.
- Keep trust marks few, explained, and visually quiet. No default red badge theme.
- No AAU production or Cloudflare changes follow from this research.

## Sources

- Virtuous Raise public page configuration for Giving Tuesday 2026, 17 November 2026.
- Public donate and campaign pages listed in the table above, same day.
- Best Friends, “Creating a Compelling Website Giving Experience.”
- Battersea, “Online fundraising page tips” (JustGiving targets and stories).
