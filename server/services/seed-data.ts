// Starter templates, used by the seed script and tests.
import type { TemplateRules } from '../../shared/templates'

const ALL = ['Hero', 'VideoHero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'Stats', 'CardGrid', 'CallToAction', 'FAQ', 'DonationEmbed', 'Embed', 'ImpactTiers', 'DonationProgress', 'MatchBanner', 'StoryBeforeAfter', 'TrustStrip']

export const STARTER_TEMPLATES: Record<string, TemplateRules> = {
  home: { schemaVersion: 1, label: 'Home', allowedBlocks: ALL, requiredBlocks: ['Hero'], startingBlocks: [] },
  standard: { schemaVersion: 1, label: 'Standard', allowedBlocks: ALL, requiredBlocks: [], startingBlocks: [] },
  campaign: { schemaVersion: 1, label: 'Campaign', allowedBlocks: ALL, requiredBlocks: ['Hero', 'DonationEmbed'], startingBlocks: [] },
  story: { schemaVersion: 1, label: 'Story', allowedBlocks: ['Hero', 'VideoHero', 'RichText', 'TextAndImage', 'Image', 'Gallery', 'Quote', 'CallToAction', 'DonationEmbed', 'StoryBeforeAfter', 'TrustStrip'], requiredBlocks: ['RichText'], startingBlocks: [] },
}
