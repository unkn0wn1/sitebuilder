// Starter block library (MVP). See docs/03-block-model.md#starter-blocks-mvp.
// Sample media and embed ids are fixed placeholders used only by tests and seeds.
import { z } from 'zod'
import { richTextDoc, richTextFromParagraphs } from '../richtext'
import { defineBlock, embedId, imageRef, linkRef, mediaId, text, tone } from './define'

export const SAMPLE_MEDIA_ID = 'med_00000000000000000000000001'
export const SAMPLE_VIDEO_ID = 'med_00000000000000000000000002'
export const SAMPLE_EMBED_ID = 'emb_00000000000000000000000001'

const sampleImage = { media: SAMPLE_MEDIA_ID, alt: 'A rescued puppy wrapped in a blanket' }

export const Hero = defineBlock({
  type: 'Hero',
  version: 1,
  label: 'Hero',
  category: 'Headers',
  props: z
    .object({
      heading: text({ max: 80, required: true }),
      subheading: text({ max: 160 }),
      image: imageRef,
      cta: linkRef.optional(),
      tone: tone.default('primary'),
    })
    .strict(),
  imageSlots: { image: { width: 1280, height: 720 } },
  headingProps: ['heading'],
  sample: { heading: 'Keep them warm this winter', subheading: 'Your gift pays for blankets, food and treatment.', image: sampleImage, cta: { label: 'Donate now', href: '#donate' } },
})


export const VideoHero = defineBlock({
  type: 'VideoHero',
  version: 1,
  label: 'Video hero',
  category: 'Headers',
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
  props: z.object({ content: richTextDoc }).strict(),
  sample: { content: richTextFromParagraphs(['Every night this winter, injured street animals need a warm, safe place to recover.']) },
})

export const TextAndImage = defineBlock({
  type: 'TextAndImage',
  version: 1,
  label: 'Text and image',
  category: 'Text',
  props: z
    .object({
      heading: text({ max: 80 }),
      content: richTextDoc,
      image: imageRef,
      layout: z.enum(['image-left', 'image-right']).default('image-right'),
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
  props: z.object({ image: imageRef, caption: text({ max: 200 }) }).strict(),
  imageSlots: { image: { width: 1280, height: 853 } },
  sample: { image: sampleImage, caption: 'Recovering in the hospital.' },
})

export const Gallery = defineBlock({
  type: 'Gallery',
  version: 1,
  label: 'Gallery',
  category: 'Media',
  props: z.object({ heading: text({ max: 80 }), images: z.array(imageRef).min(2, { message: 'Add at least 2 photos.' }).max(24) }).strict(),
  imageSlots: { images: { width: 800, height: 800 } },
  headingProps: ['heading'],
  sample: { heading: 'Rescued this month', images: [sampleImage, sampleImage] },
})

export const Quote = defineBlock({
  type: 'Quote',
  version: 1,
  label: 'Quote',
  category: 'Text',
  props: z.object({ text: text({ max: 400, required: true }), attribution: text({ max: 80 }) }).strict(),
  sample: { text: 'They gave him a second chance.', attribution: 'A volunteer' },
})

export const Stats = defineBlock({
  type: 'Stats',
  version: 1,
  label: 'Numbers',
  category: 'Lists',
  props: z
    .object({
      heading: text({ max: 80 }),
      items: z
        .array(z.object({ value: text({ max: 12, required: true }), label: text({ max: 60, required: true }) }).strict())
        .min(1)
        .max(4, { message: 'Show at most 4 numbers.' }),
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
  props: z
    .object({
      heading: text({ max: 80 }),
      cards: z
        .array(z.object({ title: text({ max: 80, required: true }), text: text({ max: 240 }), image: imageRef.optional(), link: linkRef.optional() }).strict())
        .min(1)
        .max(12),
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
  props: z.object({ heading: text({ max: 80, required: true }), text: text({ max: 240 }), button: linkRef, tone: tone.default('accent') }).strict(),
  headingProps: ['heading'],
  sample: { heading: 'Help us this winter', button: { label: 'Donate', href: '#donate' } },
})

export const FAQ = defineBlock({
  type: 'FAQ',
  version: 1,
  label: 'Questions and answers',
  category: 'Lists',
  props: z
    .object({
      heading: text({ max: 80 }),
      items: z.array(z.object({ question: text({ max: 160, required: true }), answer: richTextDoc }).strict()).min(1).max(20),
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
  props: z
    .object({
      embed: embedId,
      heading: text({ max: 80 }),
      anchor: z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, { message: 'Use lower-case letters, numbers and dashes.' }).default('donate'),
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
  props: z.object({ embed: embedId, title: text({ max: 120, required: true }) }).strict(),
  clientJs: true,
  sample: { embed: SAMPLE_EMBED_ID, title: 'Volunteer sign-up form' },
})

export const STARTER_BLOCKS = [Hero, VideoHero, RichText, TextAndImage, Image, Gallery, Quote, Stats, CardGrid, CallToAction, FAQ, DonationEmbed, Embed]
