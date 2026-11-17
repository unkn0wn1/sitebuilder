// Worked example page structures for the page-assistant planner. One full
// outline per common page type, used as few-shot context alongside the
// per-section catalogue in block-guide.ts.
import { SAMPLE_EMBED_ID, SAMPLE_MEDIA_ID } from '../blocks/library'
import type { PagePlan, PageUsage, PlannedSection } from '../page-brief'
import { richTextFromParagraphs } from '../richtext'

const photo = (alt: string) => ({ media: SAMPLE_MEDIA_ID, alt })

export interface PageTypeWorkedExample {
  usage: Extract<PageUsage, 'campaign' | 'story' | 'evergreen' | 'event'>
  label: string
  why: string
  plan: PagePlan
}

function section(type: string, purpose: string, props?: Record<string, unknown>): PlannedSection {
  return props ? { type, purpose, props } : { type, purpose }
}

export const PAGE_TYPE_EXAMPLES: PageTypeWorkedExample[] = [
  {
    usage: 'campaign',
    label: 'Campaign — Winter Blanket Appeal',
    why: 'A fundraising campaign opens clearly, keeps a match or countdown if there is one, suggests amounts with outcomes, shows progress towards a goal, tells one story, takes the gift through the registered form, shows real trust marks, and closes with a short ask in addition to the form — not instead of it.',
    plan: {
      title: 'Winter Blanket Appeal',
      slug: 'winter-blanket-appeal',
      template: 'campaign',
      purpose: 'Raise gifts for blankets, food and treatment this winter.',
      audience: 'Existing supporters',
      usage: 'campaign',
      contentNotes: 'A rescue story and photos will be added. Goal and match wording are still to be confirmed — leave them as TBC, do not invent live totals.',
      cta: { kind: 'donation', embedId: SAMPLE_EMBED_ID, label: 'Donate now', href: '#donate' },
      tone: 'primary',
      sections: [
        section('Hero', 'Open the appeal', {
          heading: 'Keep them warm this winter',
          subheading: 'Your gift pays for blankets, food and treatment.',
          image: photo('A rescued puppy wrapped in a blanket'),
          cta: { label: 'Donate now', href: '#donate' },
        }),
        section('MatchBanner', 'A match or deadline if you have one — uncheck if not', {
          message: 'Gifts received by 1 December [placeholder] will be matched up to the posted cap.',
          endDate: '2026-12-01',
          matchLine: 'Replace with the confirmed match wording, or uncheck this section if there is no match.',
        }),
        section('ImpactTiers', 'Suggested gift amounts and what each one covers', {
          heading: 'What your gift can do',
          intro: 'Example amounts — replace with the appeal’s real figures before review.',
          items: [
            { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.' },
            { amount: '₹2,000', title: 'Urgent treatment', explanation: 'Goes towards pain relief and a first medical check.' },
            { amount: '₹5,000', title: 'A hospital day', explanation: 'Helps cover a day of inpatient care and food.' },
          ],
          otherAmount: 'Or give a different amount',
          cta: { label: 'Donate now', href: '#donate' },
        }),
        section('DonationProgress', 'Progress towards the goal — uncheck if you have no target', {
          heading: 'Winter appeal progress',
          raised: 'TBC',
          goal: 'TBC',
          currency: '₹',
          label: 'raised so far',
        }),
        section('StoryBeforeAfter', 'One rescue or beneficiary story', {
          eyebrow: 'A rescue story',
          heading: 'From the roadside to recovery',
          content: richTextFromParagraphs(['She arrived overnight, too weak to stand. After treatment and rest, she began to eat again. Replace this sample with a real intake and recovery before publishing.']),
          before: photo('Arriving at the hospital'),
          beforeCaption: 'Before: arriving at the hospital',
          after: photo('Recovering in care'),
          afterCaption: 'After: recovering in care',
        }),
        section('DonationEmbed', 'The registered donation form', { heading: 'Give now', embed: SAMPLE_EMBED_ID, anchor: 'donate' }),
        section('TrustStrip', 'Real trust marks, grouped', {
          heading: 'Give with confidence',
          intro: 'Use each organisation’s real seal before publishing.',
          items: [
            { name: 'Candid', logo: photo('Candid seal'), note: 'Use the organisation’s real seal', group: 'Rated by' },
          ],
        }),
        section('CallToAction', 'A short closing ask after the form', {
          heading: 'Help us this winter',
          text: 'Every blanket and meal is paid for by people like you.',
          button: { label: 'Donate', href: '#donate' },
        }),
      ],
      seoTitle: 'Winter Blanket Appeal',
      seoDescription: 'Help keep street animals warm this winter. Your gift pays for blankets, food and treatment.',
      summary: "Here's what I'll build: Hero, MatchBanner, ImpactTiers, DonationProgress, StoryBeforeAfter, DonationEmbed, TrustStrip, CallToAction. It stays a draft. Unknown figures are TBC.",
    },
  },
  {
    usage: 'story',
    label: 'Story — Mala’s recovery',
    why: 'A story page is about one animal or person. Open with the hook, tell the written story, show before and after if you have the photos, add a real quote if you have one, show genuine trust marks, and close with a single ask. Do not invent a testimonial or a live fundraising total.',
    plan: {
      title: 'Mala’s recovery',
      slug: 'malas-recovery',
      template: 'story',
      purpose: 'Tell one rescue story and invite people to help the next animal.',
      audience: 'New visitors and existing supporters',
      usage: 'story',
      contentNotes: 'Intake and recovery photos will be uploaded. The quote is still to be confirmed.',
      cta: { kind: 'link', label: 'Help the next rescue', href: '#donate' },
      tone: 'primary',
      sections: [
        section('Hero', 'Open the story', {
          heading: 'Mala’s second chance',
          subheading: 'From a cold roadside to a warm bed in the hospital.',
          image: photo('Mala resting after treatment'),
          cta: { label: 'Help the next rescue', href: '/donate' },
        }),
        section('RichText', 'The written story', {
          content: richTextFromParagraphs([
            'Mala was found overnight, too weak to stand. The hospital team treated her injuries and kept her warm.',
            'Replace this sample with the real intake notes. Do not invent details you do not have.',
          ]),
        }),
        section('StoryBeforeAfter', 'Before and after photographs', {
          heading: 'Before and after',
          content: richTextFromParagraphs(['The pair of photographs that shows how far she has come.']),
          before: photo('Mala on arrival'),
          beforeCaption: 'Before: arriving at the hospital',
          after: photo('Mala recovering'),
          afterCaption: 'After: recovering in care',
        }),
        section('Quote', 'A real quote, if you have one', {
          text: '[placeholder] Add a real sentence from a volunteer or carer, or uncheck this section.',
          attribution: 'TBC',
        }),
        section('TrustStrip', 'Real trust marks', {
          heading: 'Give with confidence',
          items: [{ name: 'Candid', logo: photo('Candid seal'), group: 'Rated by' }],
        }),
        section('CallToAction', 'A closing ask', {
          heading: 'Help the next rescue',
          text: 'The hospital is ready for the next animal who needs a warm bed.',
          button: { label: 'Donate', href: '/donate' },
        }),
      ],
      seoTitle: 'Mala’s recovery',
      seoDescription: 'The story of one street animal’s intake and recovery, and how your gift helps the next rescue.',
      summary: "Here's what I'll build: Hero, RichText, StoryBeforeAfter, Quote, TrustStrip, CallToAction. A draft only. The quote stays a placeholder until you have a real one.",
    },
  },
  {
    usage: 'evergreen',
    label: 'Evergreen / about — Help street animals all year',
    why: 'An about or year-round giving page makes the lasting case for support, not a time-limited appeal. Open clearly, explain the work, suggest amounts with outcomes, show real trust marks, take a gift if a form is registered, and answer practical questions. Skip a match banner or progress bar unless the person has a standing target they want to show.',
    plan: {
      title: 'Help street animals all year',
      slug: 'help-street-animals',
      template: 'standard',
      purpose: 'The lasting case for supporting hospital care, feeding and treatment.',
      audience: 'New visitors learning who we are',
      usage: 'evergreen',
      contentNotes: 'About copy and trust marks are available. No campaign deadline or match.',
      cta: { kind: 'donation', embedId: SAMPLE_EMBED_ID, label: 'Donate', href: '#donate' },
      tone: 'neutral',
      sections: [
        section('Hero', 'Open the page', {
          heading: 'Care for street animals, every day of the year',
          subheading: 'The hospital, feeding and treatment are paid for by people like you.',
          image: photo('A veterinary nurse with a dog in the hospital'),
          cta: { label: 'Donate', href: '#donate' },
        }),
        section('RichText', 'The lasting case for support', {
          content: richTextFromParagraphs([
            'We treat injured and abandoned street animals, and give them a safe place to recover.',
            'This page is not a time-limited appeal. Your gift pays for the everyday work of the hospital.',
          ]),
        }),
        section('ImpactTiers', 'Suggested gift amounts', {
          heading: 'What a regular gift can do',
          intro: 'Example amounts for year-round care — replace with the real figures you stand behind.',
          items: [
            { amount: '₹500', title: 'A warm meal', explanation: 'Helps feed an animal in our care for a day.' },
            { amount: '₹2,000', title: 'A first medical check', explanation: 'Goes towards pain relief and an examination.' },
          ],
          cta: { label: 'Donate', href: '#donate' },
        }),
        section('TrustStrip', 'Real trust marks', {
          heading: 'Give with confidence',
          items: [
            { name: 'Candid', logo: photo('Candid seal'), group: 'Rated by' },
            { name: 'Charity Navigator', logo: photo('Charity Navigator'), group: 'Rated by' },
          ],
        }),
        section('DonationEmbed', 'The donation form', { heading: 'Give today', embed: SAMPLE_EMBED_ID, anchor: 'donate' }),
        section('FAQ', 'Practical questions', {
          heading: 'Questions people ask',
          items: [
            { question: 'Is my gift tax deductible?', answer: richTextFromParagraphs(['Yes, in the US. We will send a receipt.']) },
            { question: 'Can I give every month?', answer: richTextFromParagraphs(['Yes. Choose a monthly gift on the form.']) },
          ],
        }),
      ],
      seoTitle: 'Help street animals all year',
      seoDescription: 'Support hospital care, feeding and treatment for street animals, all year round.',
      summary: "Here's what I'll build: Hero, RichText, ImpactTiers, TrustStrip, DonationEmbed, FAQ. No match or progress bar, because this is year-round giving, not a campaign with a deadline.",
    },
  },
  {
    usage: 'event',
    label: 'Event — Hospital open day',
    why: 'An event page leads with what and when, uses a countdown if there is a firm date, explains how to take part, answers practical questions, and ends with the main ask (a donation form if people can give, otherwise a clear button). Add a match banner only for the date or a confirmed match, never an invented offer.',
    plan: {
      title: 'Hospital open day',
      slug: 'hospital-open-day',
      template: 'standard',
      purpose: 'Invite people to visit the hospital on a set date and support the work they see.',
      audience: 'Local supporters and volunteers',
      usage: 'event',
      contentNotes: 'The date is confirmed. There is no gift match. A donation form is registered for people who want to give after their visit.',
      cta: { kind: 'donation', embedId: SAMPLE_EMBED_ID, label: 'Give if you can', href: '#donate' },
      tone: 'accent',
      sections: [
        section('Hero', 'Open with the event', {
          heading: 'See the hospital at work',
          subheading: 'Join us on Saturday 5 December for a morning in the wards and kennels.',
          image: photo('Visitors walking through the hospital courtyard'),
          cta: { label: 'Save the date', href: '#details' },
        }),
        section('MatchBanner', 'The date or countdown', {
          message: 'Hospital open day — Saturday 5 December, 10am to 1pm.',
          endDate: '2026-12-05',
          matchLine: 'This is the event date, not a gift match.',
          hideWhenPassed: true,
        }),
        section('RichText', 'What the event is and how to take part', {
          content: richTextFromParagraphs([
            'Tours leave every half hour. You will meet the hospital team and see how animals recover in our care.',
            'Please book a free place if you can, so we know how many people to expect. Children are welcome with an adult.',
          ]),
        }),
        section('FAQ', 'Practical questions', {
          heading: 'Before you come',
          items: [
            { question: 'Do I need to book?', answer: richTextFromParagraphs(['A free booking helps us plan. Walk-ins will be welcomed if space allows.']) },
            { question: 'Where is the hospital?', answer: richTextFromParagraphs(['The address and a map will be added here before the page goes out.']) },
          ],
        }),
        section('DonationEmbed', 'The donation form, if people can give', { heading: 'Support the hospital', embed: SAMPLE_EMBED_ID, anchor: 'donate' }),
      ],
      seoTitle: 'Hospital open day',
      seoDescription: 'Visit the hospital on Saturday 5 December and see how street animals recover in our care.',
      summary: "Here's what I'll build: Hero, MatchBanner, RichText, FAQ, DonationEmbed. The banner is the event date, not an invented match offer.",
    },
  },
]

export function formatPageTypeExamples(): string {
  return PAGE_TYPE_EXAMPLES.map((example) => {
    const lines = [
      `### ${example.label}`,
      `Why this structure: ${example.why}`,
      `Title: ${example.plan.title}. Template: ${example.plan.template}. Usage: ${example.plan.usage}. Tone: ${example.plan.tone}.`,
      `Audience: ${example.plan.audience || '—'}. Purpose: ${example.plan.purpose}`,
      `Content notes: ${example.plan.contentNotes || '—'}`,
      `Call to action: ${example.plan.cta.kind}${example.plan.cta.label ? ` (“${example.plan.cta.label}”)` : ''}${example.plan.cta.embedId ? ', using the registered donation form' : ''}.`,
      'Sections:',
      ...example.plan.sections.map((s, i) => {
        const props = s.props ? ` Props: ${JSON.stringify(compactExampleProps(s.props))}` : ''
        return `${i + 1}. ${s.type} — ${s.purpose}.${props}`
      }),
    ]
    return lines.join('\n')
  }).join('\n\n')
}

/** Flatten rich text in worked-example props so the prompt stays readable. */
export function compactExampleProps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(compactExampleProps)
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    if (rec.type === 'doc' && Array.isArray(rec.content)) {
      const parts: string[] = []
      for (const node of rec.content as { type?: string; content?: { text?: string }[] }[]) {
        if (node && Array.isArray(node.content)) {
          const text = node.content.map((n) => n.text ?? '').join('')
          if (text) parts.push(text)
        }
      }
      return parts.join(' ')
    }
    return Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, compactExampleProps(v)]))
  }
  return value
}
