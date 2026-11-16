// Starter templates, used by the seed script and tests.
import type { TemplateRules } from '../../shared/templates'

const ALL = ['Hero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'Stats', 'CardGrid', 'CallToAction', 'FAQ', 'DonationEmbed', 'Embed']

export const STARTER_TEMPLATES: Record<string, TemplateRules> = {
  home: { label: 'Home', allowedBlocks: ALL, requiredBlocks: ['Hero'], startingBlocks: [] },
  standard: { label: 'Standard', allowedBlocks: ALL, requiredBlocks: [], startingBlocks: [] },
  campaign: { label: 'Campaign', allowedBlocks: ALL, requiredBlocks: ['Hero', 'DonationEmbed'], startingBlocks: [] },
  story: { label: 'Story', allowedBlocks: ['Hero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'CallToAction', 'DonationEmbed'], requiredBlocks: ['RichText'], startingBlocks: [] },
}
