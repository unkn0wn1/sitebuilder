// Starter block library (MVP). See docs/03-block-model.md#starter-blocks-mvp.
// Sample media and embed ids are fixed placeholders used only by tests and seeds.
import { z } from 'zod'
import { richTextDoc, richTextFromParagraphs } from '../richtext'
import { safeHref } from '../richtext'
import { sanitizeBadgeHtml } from '../badge-html'
import { defineBlock, embedId, imageRef, linkRef, mediaId, sectionBackground, text, tone } from './define'
import { INSTANT_PATTERN } from '../thermometer'

export const SAMPLE_MEDIA_ID = 'med_00000000000000000000000001'
export const SAMPLE_VIDEO_ID = 'med_00000000000000000000000002'
export const SAMPLE_EMBED_ID = 'emb_00000000000000000000000001'

const sampleImage = { media: SAMPLE_MEDIA_ID, alt: 'A rescued puppy wrapped in a blanket' }


const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a date like 2026-12-01.' })
const isoInstant = z.string().regex(INSTANT_PATTERN, { message: 'Use a date and time like 2026-12-02T04:59:59Z.' })
const moneyAmount = z
  .number()
  .nonnegative({ message: 'Use a number that is zero or more.' })
  .max(1_000_000_000, { message: 'That amount is too large.' })
const donorCount = z
  .number()
  .int({ message: 'Use a whole number of donors.' })
  .nonnegative({ message: 'Use a number that is zero or more.' })
  .max(100_000_000, { message: 'That number of donors is too large.' })

const badgeHtml = z
  .string()
  .trim()
  .max(4000, { message: 'Keep the badge snippet under 4,000 characters.' })
  .refine((value) => value.length === 0 || sanitizeBadgeHtml(value).html.length > 0, {
    message: 'This badge snippet could not be used. Use a logo, or a script from a known organisation such as Charity Navigator, Candid or TripAdvisor.',
  })

const heroSlide = z
  .object({
    image: imageRef.optional(),
    video: mediaId.optional(),
    heading: text({ max: 80 }),
    subheading: text({ max: 160 }),
  })
  .strict()

export const Hero = defineBlock({
  type: 'Hero',
  version: 1,
  label: 'Hero',
  category: 'Headers',
  ai: {
    purpose: 'The opening of the page: headline, a short supporting line, a photo and usually a button.',
    useWhen: 'Almost every page, especially campaigns, home and stories.',
    pairsWith: ['MatchBanner', 'CallToAction', 'DonationEmbed'],
    avoidWhen: 'The page already has a hero or a video hero. Do not stack two openings.',
    fields: 'heading (required, the promise of the page), subheading, optional cta, tone from the brand pack. Layout is one of four modes: single photo, single video, photo carousel, or video carousel. Single photo uses the image. Single video uses a poster, a video id, and the photo. Slides need a real photo, and a video carousel slide needs a video from the library. Do not stack a Hero and a VideoHero. Do not invent statistics.',
    good: {
      note: 'A clear promise, a supporting line, a real photo with alt text, and a button that jumps to the donation form.',
      props: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', image: sampleImage, cta: { label: 'Donate now', href: '#donate' } },
    },
    bad: {
      note: 'A second hero under the first, or a headline that invents a live statistic.',
      props: { heading: "We've already saved 10,000 dogs this week", subheading: 'Join the movement.' },
    },
  },
  props: z
    .object({
      heading: text({ max: 80, required: true }),
      subheading: text({ max: 160 }),
      image: imageRef,
      cta: linkRef.optional(),
      tone: tone.default('primary'),
      mode: z.enum(['image', 'video', 'image-carousel', 'video-carousel']).default('image'),
      video: mediaId.optional(),
      poster: imageRef.optional(),
      slides: z.array(heroSlide).max(8).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.mode === 'video' && !value.video) {
        ctx.addIssue({ code: 'custom', path: ['video'], message: 'Add a video for video mode.' })
      }
      if (value.mode !== 'image-carousel' && value.mode !== 'video-carousel') return
      const slides = value.slides ?? []
      if (slides.length < 2) {
        ctx.addIssue({ code: 'custom', path: ['slides'], message: 'Add at least two slides.' })
        return
      }
      slides.forEach((slide, index) => {
        if (value.mode === 'image-carousel' && !slide.image) {
          ctx.addIssue({ code: 'custom', path: ['slides', index, 'image'], message: 'Add a photo on this slide.' })
        }
        if (value.mode === 'video-carousel' && !slide.video) {
          ctx.addIssue({ code: 'custom', path: ['slides', index, 'video'], message: 'Add a video on this slide.' })
        }
      })
    }),
  imageSlots: {
    image: { width: 1280, height: 720 },
    poster: { width: 1280, height: 720 },
    'slides.image': { width: 1280, height: 720 },
  },
  headingProps: ['heading'],
  sample: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', image: sampleImage, cta: { label: 'Donate now', href: '#donate' } },
})


export const VideoHero = defineBlock({
  type: 'VideoHero',
  version: 1,
  label: 'Video hero',
  category: 'Headers',
  ai: {
    purpose: 'A hero that uses a short looping video instead of a still photo.',
    useWhen: 'A muted video and a poster frame are already in the library.',
    pairsWith: ['CallToAction', 'DonationEmbed'],
    avoidWhen: 'There is no video, or a still hero will do.',
    fields: 'heading, subheading, poster image, video id, optional cta. This is the single clip. Several clips belong on Hero.',
    good: {
      note: 'A short muted clip already in the library, with a still poster and the same clear ask as a still hero.',
      props: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', poster: sampleImage, video: SAMPLE_VIDEO_ID, cta: { label: 'Donate now', href: '#donate' } },
    },
    bad: {
      note: 'Choosing a video hero when there is no video, or stacking it under a still Hero.',
      props: { heading: 'Watch our work', subheading: 'A film will be added later.' },
    },
  },
  props: z
    .object({
      heading: text({ max: 80, required: true }),
      subheading: text({ max: 160 }),
      poster: imageRef,
      video: mediaId,
      cta: linkRef.optional(),
      tone: tone.default('primary'),
    })
    .strict(),
  imageSlots: { poster: { width: 1280, height: 720 } },
  headingProps: ['heading'],
  sample: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', poster: sampleImage, video: SAMPLE_VIDEO_ID, cta: { label: 'Donate now', href: '#donate' } },
})

export const RichText = defineBlock({
  type: 'RichText',
  version: 1,
  label: 'Text',
  category: 'Text',
  ai: {
    purpose: 'The main written section — story, explanation or details.',
    useWhen: 'You need body copy that is not tied to a photo layout.',
    pairsWith: ['TextAndImage', 'Quote', 'StoryBeforeAfter'],
    avoidWhen: 'The copy is only a short ask (use CallToAction) or a list of gift amounts (use ImpactTiers).',
    fields: 'content as rich text. Do not invent figures; mark unknowns as placeholders.',
    good: {
      note: 'A short, factual story or explanation, with unknowns marked rather than invented.',
      props: { content: richTextFromParagraphs(['Every night this winter, injured street animals need a warm, safe place to recover.', 'Your gift pays for blankets, food and treatment while they heal.']) },
    },
    bad: {
      note: 'A wall of gift amounts (use ImpactTiers), or copy that invents totals and quotes.',
      props: { content: richTextFromParagraphs(['Give £10, £25 or £50. We have already raised £1 million this month.']) },
    },
  },
  props: z.object({ content: richTextDoc, background: sectionBackground }).strict(),
  sample: { content: richTextFromParagraphs(['Every night this winter, injured street animals need a warm, safe place to recover.']) },
})

export const TextAndImage = defineBlock({
  type: 'TextAndImage',
  version: 1,
  label: 'Text and image',
  category: 'Text',
  ai: {
    purpose: 'A section of copy beside a photograph.',
    useWhen: 'A short story or explanation with one supporting image.',
    pairsWith: ['Hero', 'Quote', 'CallToAction'],
    avoidWhen: 'It is a true before-and-after rescue (use StoryBeforeAfter) or a set of photos (use Gallery).',
    fields: 'heading, content, image with alt, layout (image-left or image-right).',
    good: {
      note: 'One supporting photograph beside a short explanation.',
      props: { heading: 'How your gift helps', content: richTextFromParagraphs(['Blankets, food and treatment for animals in our care.']), image: sampleImage },
    },
    bad: {
      note: 'Using this for a true before-and-after rescue (use StoryBeforeAfter) or for a row of photos (use Gallery).',
      props: { heading: 'Before and after', content: richTextFromParagraphs(['She arrived injured. Now she is well.']) },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      content: richTextDoc,
      image: imageRef,
      layout: z.enum(['image-left', 'image-right']).default('image-right'),
      background: sectionBackground,
    })
    .strict(),
  imageSlots: { image: { width: 960, height: 720 } },
  headingProps: ['heading'],
  sample: { heading: 'How your gift helps', content: richTextFromParagraphs(['Blankets, food and treatment for animals in our care.']), image: sampleImage },
})

export const Image = defineBlock({
  type: 'Image',
  version: 1,
  label: 'Image',
  category: 'Media',
  ai: {
    purpose: 'A single photograph with an optional caption.',
    useWhen: 'One photo needs to stand on its own.',
    pairsWith: ['RichText', 'StoryBeforeAfter'],
    avoidWhen: 'You need a row of photos (Gallery) or a photo-and-copy layout (TextAndImage).',
    fields: 'image with alt text, optional caption.',
    good: {
      note: 'A single photograph with real alt text and a short caption.',
      props: { image: sampleImage, caption: 'Recovering in the hospital.' },
    },
    bad: {
      note: 'A photo with no alt text, or a single image used where a gallery or before-and-after pair belongs.',
      props: { image: { media: SAMPLE_MEDIA_ID }, caption: '' },
    },
  },
  props: z.object({ image: imageRef, caption: text({ max: 200 }), background: sectionBackground }).strict(),
  imageSlots: { image: { width: 1280, height: 853 } },
  sample: { image: sampleImage, caption: 'Recovering in the hospital.' },
})

export const Gallery = defineBlock({
  type: 'Gallery',
  version: 1,
  label: 'Gallery',
  category: 'Media',
  ai: {
    purpose: 'A row of photographs.',
    useWhen: 'Several photos belong together, for example animals in care or an event.',
    pairsWith: ['RichText', 'StoryBeforeAfter'],
    avoidWhen: 'There is only one photo, or a formal before-and-after pair.',
    fields: 'optional heading, images with alt text.',
    good: {
      note: 'Several related photographs, each with alt text, under a short heading.',
      props: { heading: 'Rescued this month', images: [sampleImage, { media: SAMPLE_MEDIA_ID, alt: 'A dog resting after treatment' }] },
    },
    bad: {
      note: 'A single photo, or a formal before-and-after pair presented as a gallery.',
      props: { heading: 'Before and after', images: [sampleImage] },
    },
  },
  props: z.object({ heading: text({ max: 80 }), images: z.array(imageRef).min(2, { message: 'Add at least 2 photos.' }).max(24), background: sectionBackground }).strict(),
  imageSlots: { images: { width: 800, height: 800 } },
  headingProps: ['heading'],
  sample: { heading: 'Rescued this month', images: [sampleImage, sampleImage] },
})

export const Quote = defineBlock({
  type: 'Quote',
  version: 1,
  label: 'Quote',
  category: 'Text',
  ai: {
    purpose: 'A short quotation with attribution.',
    useWhen: 'You have a real quote from a volunteer, donor or carer.',
    pairsWith: ['StoryBeforeAfter', 'RichText'],
    avoidWhen: 'You do not have a real quote. Never invent one.',
    fields: 'text (required), optional attribution. If the quote is unknown, leave this section out or mark it as a placeholder.',
    good: {
      note: 'A real sentence, attributed to a real person, used beside a story.',
      props: { text: 'They gave him a second chance.', attribution: 'A volunteer' },
    },
    bad: {
      note: 'An invented testimonial, or a quote with no source presented as fact.',
      props: { text: 'This charity is the best I have ever supported.', attribution: 'A grateful donor' },
    },
  },
  props: z.object({ text: text({ max: 400, required: true }), attribution: text({ max: 80 }), background: sectionBackground }).strict(),
  sample: { text: 'They gave him a second chance.', attribution: 'A volunteer' },
})

export const Stats = defineBlock({
  type: 'Stats',
  version: 1,
  label: 'Numbers',
  category: 'Lists',
  ai: {
    purpose: 'A few headline numbers, such as animals treated.',
    useWhen: 'You have real, current figures you are willing to stand behind.',
    pairsWith: ['TrustStrip', 'ImpactTiers'],
    avoidWhen: 'The figures are unknown, out of date or guesses. Never invent live totals.',
    fields: 'optional heading, up to four items with value and label. Use TBC or [placeholder] when a figure is not known.',
    good: {
      note: 'A small set of figures the charity will stand behind, or clearly marked as TBC.',
      props: { heading: 'This year so far', items: [{ value: '1,000+', label: 'animals treated each month' }] },
    },
    bad: {
      note: 'Invented or out-of-date headline numbers presented as live totals.',
      props: { items: [{ value: '1 million', label: 'lives changed this week' }] },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      items: z
        .array(z.object({ value: text({ max: 12, required: true }), label: text({ max: 60, required: true }) }).strict())
        .min(1)
        .max(4, { message: 'Show at most 4 numbers.' }),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  sample: { items: [{ value: '1,000+', label: 'animals treated each month' }] },
})

export const CardGrid = defineBlock({
  type: 'CardGrid',
  version: 1,
  label: 'Cards',
  category: 'Lists',
  ai: {
    purpose: 'A set of short cards (ways to help, programmes or links).',
    useWhen: 'You want several equal options or destinations.',
    pairsWith: ['Hero', 'CallToAction'],
    avoidWhen: 'The items are gift amounts (use ImpactTiers) or questions (use FAQ).',
    fields: 'optional heading, cards with title, short text, optional image and link.',
    good: {
      note: 'Equal destinations or ways to help, each with a short explanation.',
      props: { heading: 'Ways to help', cards: [{ title: 'Adopt', text: 'Give a rescued animal a home.' }, { title: 'Volunteer', text: 'Spend time with animals in our care.' }] },
    },
    bad: {
      note: 'Cards that are only gift amounts with no outcome (use ImpactTiers), or a list of questions (use FAQ).',
      props: { cards: [{ title: '₹500' }, { title: '₹2,000' }, { title: '₹5,000' }] },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      cards: z
        .array(z.object({ title: text({ max: 80, required: true }), text: text({ max: 240 }), image: imageRef.optional(), link: linkRef.optional() }).strict())
        .min(1)
        .max(12),
      background: sectionBackground,
    })
    .strict(),
  imageSlots: { 'cards.image': { width: 640, height: 480 } },
  headingProps: ['heading'],
  sample: { cards: [{ title: 'Adopt', text: 'Give a rescued animal a home.' }] },
})

export const CallToAction = defineBlock({
  type: 'CallToAction',
  version: 1,
  label: 'Call to action',
  category: 'Calls to action',
  ai: {
    purpose: 'A mid-page or closing ask with a button.',
    useWhen: 'People should donate, sign up or follow a link. On a campaign, use this as the closing ask after the donation form.',
    pairsWith: ['DonationEmbed', 'Hero', 'ImpactTiers', 'TrustStrip'],
    avoidWhen: 'A second identical button would only repeat the form with no extra line of encouragement.',
    fields: 'heading, optional text, button label and href, tone from the brand pack.',
    good: {
      note: 'A short closing ask after the donation form, pointing at the same #donate anchor.',
      props: { heading: 'Help us this winter', text: 'Every blanket and meal is paid for by people like you.', button: { label: 'Donate', href: '#donate' } },
    },
    bad: {
      note: 'Repeating the same donate button with no new line of encouragement, or using this instead of a registered donation form on a campaign.',
      props: { heading: 'Donate', button: { label: 'Donate', href: '#donate' } },
    },
  },
  props: z.object({ heading: text({ max: 80, required: true }), text: text({ max: 240 }), button: linkRef, tone: tone.default('accent') }).strict(),
  headingProps: ['heading'],
  sample: { heading: 'Help us this winter', button: { label: 'Donate', href: '#donate' } },
})

export const FAQ = defineBlock({
  type: 'FAQ',
  version: 1,
  label: 'Questions and answers',
  category: 'Lists',
  ai: {
    purpose: 'Questions and answers people actually ask.',
    useWhen: 'There are real questions, for example about tax, amounts or what happens next.',
    pairsWith: ['DonationEmbed', 'CallToAction'],
    avoidWhen: 'You would have to invent both the questions and the answers.',
    fields: 'optional heading, items with a question and a rich-text answer.',
    good: {
      note: 'Questions people actually ask, with answers the charity can stand behind.',
      props: { heading: 'Questions people ask', items: [{ question: 'Is my gift tax deductible?', answer: richTextFromParagraphs(['Yes, in the US. We will send a receipt.']) }] },
    },
    bad: {
      note: 'Invented questions and answers, or using an FAQ as the whole campaign.',
      props: { items: [{ question: 'Why are we the best charity?', answer: richTextFromParagraphs(['Because every gift changes a million lives.']) }] },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      items: z.array(z.object({ question: text({ max: 160, required: true }), answer: richTextDoc }).strict()).min(1).max(20),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  sample: { items: [{ question: 'Is my gift tax deductible?', answer: richTextFromParagraphs(['Yes, in the US.']) }] },
})

export const DonationEmbed = defineBlock({
  type: 'DonationEmbed',
  version: 1,
  label: 'Donation form',
  category: 'Embeds',
  ai: {
    purpose: 'The registered donation form (for example Virtuous) on the page.',
    useWhen: 'The page should take a gift, and a form is already registered under Forms and embeds.',
    pairsWith: ['ImpactTiers', 'DonationProgress', 'MatchBanner', 'CallToAction', 'TrustStrip'],
    avoidWhen: 'No form is registered — use a CallToAction that links to donate instead. Never paste embed code.',
    fields: 'embed id from the registered list, optional heading, anchor (usually donate).',
    good: {
      note: 'The registered donation form, anchored at #donate, placed after the story and amounts.',
      props: { heading: 'Give now', embed: SAMPLE_EMBED_ID, anchor: 'donate' },
    },
    bad: {
      note: 'Pasting raw embed code, or adding a donation form when none is registered — use a CallToAction link instead.',
      props: { heading: 'Paste this iframe', anchor: 'donate' },
    },
  },
  props: z
    .object({
      embed: embedId,
      heading: text({ max: 80 }),
      anchor: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, { message: 'Use lower-case letters, numbers and dashes.' }).default('donate'),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  clientJs: true,
  sample: { embed: SAMPLE_EMBED_ID, anchor: 'donate' },
})

export const Embed = defineBlock({
  type: 'Embed',
  version: 1,
  label: 'Embed (video, map, form)',
  category: 'Embeds',
  ai: {
    purpose: 'A registered third-party embed that is not the donation form (video, map or sign-up).',
    useWhen: 'A YouTube talk, volunteer form or map is already registered.',
    pairsWith: ['RichText'],
    avoidWhen: 'It is a donation form (use DonationEmbed), or you would have to paste raw code.',
    fields: 'embed id, title.',
    good: {
      note: 'A registered volunteer form, talk or map, labelled clearly.',
      props: { embed: SAMPLE_EMBED_ID, title: 'Volunteer sign-up form' },
    },
    bad: {
      note: 'Using this for the donation form (use DonationEmbed), or pasting raw third-party code.',
      props: { title: 'Donation form' },
    },
  },
  props: z.object({ embed: embedId, title: text({ max: 120, required: true }), background: sectionBackground }).strict(),
  clientJs: true,
  sample: { embed: SAMPLE_EMBED_ID, title: 'Volunteer sign-up form' },
})


export const ImpactTiers = defineBlock({
  type: 'ImpactTiers',
  version: 1,
  label: 'Impact tiers',
  category: 'Calls to action',
  ai: {
    purpose: 'Suggested gift amounts and what each one covers.',
    useWhen: 'Campaigns and evergreen donation pages that suggest amounts.',
    pairsWith: ['DonationEmbed', 'DonationProgress', 'CallToAction'],
    avoidWhen: 'You would present invented impact claims as fact. Use placeholders until the real amounts are known.',
    fields: 'heading, intro, optional eyebrow, layout (grid or picker; grid is the default card row), items (amount, title, explanation, optional frequency once/monthly/quarterly/annually, optional image), optional other-amount line and cta.',
    good: {
      note: 'Each amount has a title and a concrete outcome. Unknown figures are marked as examples, not live claims.',
      props: {
        heading: 'What your gift can do',
        intro: 'These are example amounts — replace them with the appeal\'s real figures before review.',
        items: [
          { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.' },
          { amount: '₹2,000', title: 'Urgent treatment', explanation: 'Goes towards pain relief and a first medical check.' },
          { amount: '₹5,000', title: 'A hospital day', explanation: 'Helps cover a day of inpatient care and food.' },
        ],
        otherAmount: 'Or give a different amount',
        cta: { label: 'Donate now', href: '#donate' },
      },
    },
    bad: {
      note: 'Bare amounts with no outcomes, or invented impact claims presented as fact.',
      props: { heading: 'Give', items: [{ amount: '₹500' }, { amount: '₹2,000' }, { amount: '₹5,000' }] },
    },
  },
  props: z
    .object({
      eyebrow: text({ max: 40 }),
      heading: text({ max: 80 }),
      intro: text({ max: 240 }),
      layout: z.enum(['grid', 'picker']).default('grid'),
      items: z
        .array(
          z
            .object({
              amount: text({ max: 24, required: true }),
              title: text({ max: 80 }),
              explanation: text({ max: 200 }),
              frequency: z.enum(['once', 'monthly', 'quarterly', 'annually']).optional(),
              image: imageRef.optional(),
            })
            .strict(),
        )
        .min(1, { message: 'Add at least one amount.' })
        .max(8, { message: 'Show at most 8 amounts.' }),
      otherAmount: text({ max: 80 }),
      cta: linkRef.optional(),
      background: sectionBackground,
    })
    .strict(),
  imageSlots: { 'items.image': { width: 640, height: 480 } },
  headingProps: ['heading'],
  sample: {
    heading: 'What your gift can do',
    intro: 'These are example amounts for this demo, not a live appeal.',
    items: [
      { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.' },
      { amount: '₹2,000', title: 'Urgent treatment', explanation: 'Goes towards pain relief and a first medical check.' },
      { amount: '₹5,000', title: 'A hospital day', explanation: 'Helps cover a day of inpatient care and food.' },
    ],
    otherAmount: 'Or give a different amount',
    cta: { label: 'Donate now', href: '#donate' },
  },
})

export const DonationProgress = defineBlock({
  type: 'DonationProgress',
  version: 1,
  label: 'Donation progress',
  category: 'Calls to action',
  ai: {
    purpose: 'A progress bar towards a campaign goal.',
    useWhen: 'The campaign has a real goal, or you can clearly mark the raised and goal figures as placeholders.',
    pairsWith: ['MatchBanner', 'ImpactTiers', 'DonationEmbed'],
    avoidWhen: 'There is no goal and no plan to add one. Never present sample totals as live figures.',
    fields: 'heading, raised, goal, currency, label, optional endDate and matchLine, optional cta. Use TBC when the real numbers are unknown.',
    good: {
      note: 'A real goal and a raised figure, or both clearly marked as TBC / sample — never presented as live totals unless they are.',
      props: {
        heading: 'Winter appeal progress',
        raised: 'TBC',
        goal: 'TBC',
        currency: '₹',
        label: 'raised so far',
        endDate: '2026-12-13',
        matchLine: 'Replace these figures before review. Do not publish sample totals as live.',
        cta: { label: 'Give now', href: '#donate' },
      },
    },
    bad: {
      note: 'A progress bar with a raised amount and no goal, or sample totals written as if they were live.',
      props: { heading: 'Progress', raised: '87,400', currency: '₹', label: 'already raised' },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      raised: text({ max: 24, required: true }),
      goal: text({ max: 24, required: true }),
      currency: text({ max: 8 }),
      label: text({ max: 80 }),
      endDate: isoDate.optional(),
      matchLine: text({ max: 160 }),
      cta: linkRef.optional(),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  sample: {
    heading: 'Winter appeal progress',
    raised: '87,400',
    goal: '2,50,000',
    currency: '₹',
    label: 'raised so far (sample figures for this demo)',
    endDate: '2026-12-13',
    matchLine: 'Sample campaign only — not live totals.',
    cta: { label: 'Give now', href: '#donate' },
  },
})

export const MatchBanner = defineBlock({
  type: 'MatchBanner',
  version: 1,
  label: 'Match or countdown',
  category: 'Calls to action',
  ai: {
    purpose: 'A match offer or a countdown to a deadline, for example Giving Tuesday.',
    useWhen: 'There is a confirmed match, deadline or event date, or the plan is keeping a placeholder to fill in.',
    pairsWith: ['DonationProgress', 'DonationEmbed', 'Hero'],
    avoidWhen: 'The person has said there is no deadline or match. Never invent a match offer.',
    fields: 'message, optional endDate, matchLine, tone, hideWhenPassed, optional cta.',
    good: {
      note: 'A confirmed deadline or match, or a clearly marked placeholder the editor will fill in.',
      props: {
        message: 'Gifts received by 1 December will be matched, pound for pound, up to the posted cap.',
        endDate: '2026-12-01',
        matchLine: 'Replace with the confirmed match wording before review.',
        tone: 'neutral',
        hideWhenPassed: true,
        cta: { label: 'Donate now', href: '#donate' },
      },
    },
    bad: {
      note: 'An invented match offer, or a countdown when the person has said there is no deadline.',
      props: { message: 'A generous donor will double every gift, forever.', hideWhenPassed: false },
    },
  },
  props: z
    .object({
      message: text({ max: 200, required: true }),
      endDate: isoDate.optional(),
      matchLine: text({ max: 160 }),
      tone: tone.default('neutral'),
      hideWhenPassed: z.boolean().default(true),
      cta: linkRef.optional(),
    })
    .strict(),
  clientJs: true,
  sample: {
    message: 'A sample match: gifts in this demo are shown as doubled until Giving Tuesday.',
    endDate: '2026-12-01',
    matchLine: 'This is demonstration copy, not a live match offer.',
    tone: 'neutral',
    hideWhenPassed: true,
    cta: { label: 'Donate now', href: '#donate' },
  },
})

export const StoryBeforeAfter = defineBlock({
  type: 'StoryBeforeAfter',
  version: 1,
  label: 'Story with before and after',
  category: 'Text',
  ai: {
    purpose: 'A rescue or beneficiary story with before and after photographs.',
    useWhen: 'You have, or will add, a real story and a pair of photos.',
    pairsWith: ['Quote', 'DonationEmbed', 'TrustStrip', 'Hero'],
    avoidWhen: 'There is no story and no photos — use RichText or TextAndImage instead.',
    fields: 'eyebrow, heading, content, optional quote and attribution (only if real), before and after images and captions, optional cta.',
    good: {
      note: 'A real or clearly-sample rescue story, with a captioned before and after pair. Quotes only if they are real or marked as samples.',
      props: {
        eyebrow: 'A rescue story',
        heading: 'From the roadside to recovery',
        content: richTextFromParagraphs(['She arrived overnight, too weak to stand. After treatment and rest in the hospital, she began to eat again. Replace this sample with a real intake and recovery before publishing.']),
        quote: 'We did not know if she would make it through the night.',
        attribution: 'A hospital volunteer (sample quote)',
        before: sampleImage,
        beforeCaption: 'Before: arriving at the hospital',
        after: sampleImage,
        afterCaption: 'After: recovering in care',
        cta: { label: 'Help the next rescue', href: '#donate' },
      },
    },
    bad: {
      note: 'A fictional rescue presented as fact, a quote with no source, or only one photograph.',
      props: { heading: 'A miracle story', quote: 'This organisation saved my life instantly.' },
    },
  },
  props: z
    .object({
      eyebrow: text({ max: 80 }),
      heading: text({ max: 80 }),
      content: richTextDoc,
      quote: text({ max: 400 }),
      attribution: text({ max: 80 }),
      before: imageRef,
      beforeCaption: text({ max: 200 }),
      after: imageRef,
      afterCaption: text({ max: 200 }),
      cta: linkRef.optional(),
      background: sectionBackground,
    })
    .strict(),
  imageSlots: { before: { width: 960, height: 720 }, after: { width: 960, height: 720 } },
  headingProps: ['heading'],
  sample: {
    eyebrow: 'A rescue story',
    heading: 'From the roadside to recovery',
    content: richTextFromParagraphs(['This is a sample story for the demo, written in the voice of a rescue page. Replace it with a real animal’s intake and recovery photos before publishing a campaign.']),
    quote: 'We did not know if she would make it through the night.',
    attribution: 'A hospital volunteer (sample quote)',
    before: sampleImage,
    beforeCaption: 'Before: arriving at the hospital (sample photo)',
    after: sampleImage,
    afterCaption: 'After: recovering in care (sample photo)',
    cta: { label: 'Help the next rescue', href: '#donate' },
  },
})

export const TrustStrip = defineBlock({
  type: 'TrustStrip',
  version: 1,
  label: 'Trust marks',
  category: 'Lists',
  ai: {
    purpose: 'A quiet row of real trust marks, ratings or partners.',
    useWhen: 'You have genuine seals or partner logos. Group regulators separately from travel or review sites.',
    pairsWith: ['DonationEmbed', 'CallToAction', 'Stats'],
    avoidWhen: 'You would have to invent ratings, or mix regulator badges with travel reviews in one group.',
    fields: 'heading, intro, items with name, optional logo or an allow-listed badge snippet, note, href and group.',
    good: {
      note: 'Genuine seals or partner logos, grouped so regulator ratings stay separate from travel or review sites.',
      props: {
        heading: 'Give with confidence',
        intro: 'Independent marks for this organisation. Use each organisation\'s real seal before publishing.',
        items: [
          { name: 'Candid Platinum', logo: sampleImage, note: 'Guidestar / Candid seal', group: 'Rated by' },
          { name: 'Charity Navigator', logo: sampleImage, note: 'Use the organisation\'s real rating', group: 'Rated by' },
        ],
      },
    },
    bad: {
      note: 'Mixing regulator badges, travel reviews and invented star ratings in one ungrouped row.',
      props: {
        heading: 'Everyone loves us',
        items: [
          { name: 'Candid', logo: sampleImage, note: 'Platinum' },
          { name: 'TripAdvisor', logo: sampleImage, note: '5 stars' },
          { name: 'Google', logo: sampleImage, note: '4.9 stars — invented' },
        ],
      },
    },
  },
  props: z
    .object({
      heading: text({ max: 80 }),
      intro: text({ max: 240 }),
      items: z
        .array(
          z
            .object({
              name: text({ max: 80, required: true }),
              logo: imageRef.optional(),
              note: text({ max: 120 }),
              href: safeHref.optional(),
              badgeHtml: badgeHtml.optional(),
              group: text({ max: 40 }),
            })
            .strict()
            .refine((item) => Boolean(item.logo?.media || (item.badgeHtml && item.badgeHtml.trim())), {
              message: 'Add a logo or a badge snippet.',
            }),
        )
        .min(1, { message: 'Add at least one mark.' })
        .max(8, { message: 'Show at most 8 marks.' }),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  sample: {
    heading: 'Trusted by donors',
    items: [
      { name: 'Candid Platinum', logo: sampleImage },
      { name: 'Charity Navigator', logo: sampleImage },
    ],
  },
})

export const MatchThermometer = defineBlock({
  type: 'MatchThermometer',
  version: 1,
  label: 'Match thermometer',
  category: 'Calls to action',
  clientJs: true,
  ai: {
    purpose: 'A match-fund thermometer: gifts raised, the match, a goal, and a countdown.',
    useWhen: 'A campaign has a real goal, a match cap, and a deadline, or you can mark the figures as examples to replace.',
    pairsWith: ['DonationEmbed', 'ImpactTiers', 'MatchBanner', 'CallToAction'],
    avoidWhen: 'There is no match and no goal. Never present sample totals as live figures.',
    fields: 'eyebrow, heading, intro, currency, goal, raised, matched, donors, matchCap, optional matchUsed (otherwise the smaller of matched and matchCap), endsAt as an ISO instant, endLabel, optional countdownHeading, cta, optional note.',
    good: {
      note: 'The appeal sample figures, with a note that they must be replaced with the real totals before review.',
      props: {
        eyebrow: 'Giving Tuesday 2026',
        heading: 'Every gift doubled for street animals',
        intro: 'Until the match fund runs out, every dollar you give is matched. Watch the thermometer fill as the community comes together.',
        currency: '$',
        goal: 60000,
        raised: 14400,
        matched: 14400,
        donors: 412,
        matchCap: 20000,
        endsAt: '2026-12-02T04:59:59.000Z',
        endLabel: 'Tuesday 1 Dec 2026, 11:59 pm US Eastern',
        countdownHeading: 'Giving Tuesday ends in',
        cta: { label: 'Donate: double your gift', href: '#donate' },
        note: 'Your $50 becomes $100 for injured street animals.',
      },
    },
    bad: {
      note: 'Invented totals presented as if they were live, with no sign they are examples.',
      props: {
        heading: 'We have already raised this',
        goal: 1000000,
        raised: 999999,
        matched: 999999,
        donors: 50000,
        matchCap: 1000000,
        endsAt: '2099-01-01T00:00:00Z',
        endLabel: 'Forever',
        cta: { label: 'Give', href: '#donate' },
      },
    },
  },
  props: z
    .object({
      eyebrow: text({ max: 40 }),
      heading: text({ max: 80 }),
      intro: text({ max: 240 }),
      currency: z.string().trim().max(4, { message: 'Keep this under 4 characters.' }).default('$'),
      goal: moneyAmount,
      raised: moneyAmount,
      matched: moneyAmount,
      donors: donorCount,
      matchCap: moneyAmount,
      matchUsed: moneyAmount.optional(),
      endsAt: isoInstant,
      endLabel: text({ max: 120, required: true }),
      countdownHeading: text({ max: 80 }),
      cta: linkRef.optional(),
      note: text({ max: 160 }),
      background: sectionBackground,
    })
    .strict(),
  headingProps: ['heading'],
  sample: {
    eyebrow: 'Giving Tuesday 2026',
    heading: 'Every gift doubled for street animals',
    intro: 'Until the match fund runs out, every dollar you give is matched. Watch the thermometer fill as the community comes together.',
    currency: '$',
    goal: 60000,
    raised: 14400,
    matched: 14400,
    donors: 412,
    matchCap: 20000,
    endsAt: '2026-12-02T04:59:59.000Z',
    endLabel: 'Tuesday 1 Dec 2026, 11:59 pm US Eastern',
    countdownHeading: 'Giving Tuesday ends in',
    cta: { label: 'Donate: double your gift', href: '#donate' },
    note: 'Your $50 becomes $100 for injured street animals.',
  },
})

export const STARTER_BLOCKS = [Hero, VideoHero, RichText, TextAndImage, Image, Gallery, Quote, Stats, CardGrid, CallToAction, FAQ, DonationEmbed, Embed, ImpactTiers, DonationProgress, MatchBanner, MatchThermometer, StoryBeforeAfter, TrustStrip]
