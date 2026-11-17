<script setup lang="ts">
import type { StoredBlock } from '#shared/blocks/registry'
import type { ImageRef } from '#shared/blocks/define'

const props = defineProps<{
  block: StoredBlock
  selected?: boolean
  firstHero?: boolean
}>()

const emit = defineEmits<{
  select: []
  changeText: [prop: string, value: string]
}>()

const p = computed(() => props.block.props as Record<string, unknown>)

function imageSrc(ref: ImageRef | undefined, width = 960): string | undefined {
  if (!ref?.media) return undefined
  return `/media/${ref.media}-${width}.webp`
}

function onInline(prop: string, event: Event) {
  const el = event.target as HTMLElement
  emit('changeText', prop, (el.textContent ?? '').replace(/\s+/g, ' ').trim())
}

function asLink(value: unknown): { label: string; href: string } | undefined {
  if (value && typeof value === 'object' && 'label' in value && 'href' in value) {
    const link = value as { label: string; href: string }
    return link
  }
  return undefined
}

function asImage(value: unknown): ImageRef | undefined {
  if (value && typeof value === 'object' && 'media' in value) return value as ImageRef
  return undefined
}

function asItems<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function progressValue(raised: unknown, goal: unknown): number {
  const r = Number(String(raised ?? '').replace(/[^0-9.]/g, ''))
  const g = Number(String(goal ?? '').replace(/[^0-9.]/g, ''))
  if (!Number.isFinite(r) || !Number.isFinite(g) || g <= 0) return 0
  return Math.max(0, Math.min(100, Math.round((r / g) * 100)))
}

interface TrustPreviewItem {
  name: string
  logo?: ImageRef
  note?: string
  badgeHtml?: string
  group?: string
}

function trustGroups(value: unknown): { label: string; items: TrustPreviewItem[] }[] {
  const groups: { label: string; items: TrustPreviewItem[] }[] = []
  for (const item of asItems<TrustPreviewItem>(value)) {
    const label = item.group?.trim() ?? ''
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(item)
    else groups.push({ label, items: [item] })
  }
  return groups
}
</script>

<template>
  <div class="relative" :class="{ 'sb-section-selected': selected }" @click.stop="emit('select')">
    <!-- Hero / Video hero -->
    <section
      v-if="block.type === 'Hero' || block.type === 'VideoHero'"
      class="hero"
      :aria-label="String(p.heading ?? '')"
    >
      <img
        v-if="asImage((block.type === 'VideoHero' ? p.poster : p.image) as never)"
        :src="imageSrc(asImage((block.type === 'VideoHero' ? p.poster : p.image) as never), 1280)"
        alt=""
        class="hero-media"
        @error="($event.target as HTMLImageElement).style.display = 'none'"
      >
      <div class="hero-inner">
        <h1 class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading ?? '') }}</h1>
        <p v-if="p.subheading" class="sb-inline" contenteditable="true" @blur="onInline('subheading', $event)">{{ String(p.subheading) }}</p>
        <a v-if="asLink(p.cta)" class="btn" :href="asLink(p.cta)!.href" @click.prevent>{{ asLink(p.cta)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'RichText'" class="section">
      <div class="wrap">
        <EditorRichTextView :doc="p.content" />
      </div>
    </section>

    <section v-else-if="block.type === 'TextAndImage'" class="section">
      <div class="wrap">
        <div class="split" :class="{ 'split-image-left': p.layout === 'image-left' }">
          <div class="split-copy prose">
            <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
            <EditorRichTextView :doc="p.content" />
          </div>
          <img
            v-if="asImage(p.image)"
            :src="imageSrc(asImage(p.image), 960)"
            :alt="asImage(p.image)?.alt ?? ''"
            @error="($event.target as HTMLImageElement).style.opacity = '0.2'"
          >
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'Image'" class="section">
      <div class="wrap">
        <figure class="figure">
          <img
            v-if="asImage(p.image)"
            :src="imageSrc(asImage(p.image), 1280)"
            :alt="asImage(p.image)?.alt ?? ''"
            @error="($event.target as HTMLImageElement).style.opacity = '0.2'"
          >
          <figcaption v-if="p.caption" class="sb-inline" contenteditable="true" @blur="onInline('caption', $event)">{{ String(p.caption) }}</figcaption>
        </figure>
      </div>
    </section>

    <section v-else-if="block.type === 'Gallery'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <div class="gallery">
          <img
            v-for="(img, i) in asItems<ImageRef>(p.images)"
            :key="i"
            :src="imageSrc(img, 800)"
            :alt="img.alt ?? ''"
            @error="($event.target as HTMLImageElement).style.opacity = '0.2'"
          >
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'Quote'" class="section">
      <div class="wrap">
        <blockquote class="quote">
          <p class="sb-inline" contenteditable="true" @blur="onInline('text', $event)">{{ String(p.text ?? '') }}</p>
          <footer v-if="p.attribution" class="sb-inline" contenteditable="true" @blur="onInline('attribution', $event)">{{ String(p.attribution) }}</footer>
        </blockquote>
      </div>
    </section>

    <section v-else-if="block.type === 'Stats'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <div class="stats">
          <div v-for="(item, i) in asItems<{ value: string; label: string }>(p.items)" :key="i">
            <span class="stat-value">{{ item.value }}</span>
            <span class="stat-label">{{ item.label }}</span>
          </div>
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'CardGrid'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <div class="cards">
          <article v-for="(card, i) in asItems<{ title: string; text?: string; image?: ImageRef; link?: { label: string; href: string } }>(p.cards)" :key="i" class="card">
            <img
              v-if="card.image"
              :src="imageSrc(card.image, 640)"
              :alt="card.image.alt ?? ''"
              @error="($event.target as HTMLImageElement).style.opacity = '0.2'"
            >
            <div class="card-body">
              <h3>{{ card.title }}</h3>
              <p v-if="card.text">{{ card.text }}</p>
              <a v-if="card.link" class="btn" :href="card.link.href" @click.prevent>{{ card.link.label }}</a>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'CallToAction'" class="cta-band" :class="`tone-${String(p.tone ?? 'accent')}`">
      <div class="wrap">
        <h2 class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading ?? '') }}</h2>
        <p v-if="p.text" class="sb-inline" contenteditable="true" @blur="onInline('text', $event)">{{ String(p.text) }}</p>
        <a v-if="asLink(p.button)" class="btn" :href="asLink(p.button)!.href" @click.prevent>{{ asLink(p.button)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'FAQ'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <div class="faq">
          <details v-for="(item, i) in asItems<{ question: string; answer: unknown }>(p.items)" :key="i">
            <summary>{{ item.question }}</summary>
            <EditorRichTextView :doc="item.answer" />
          </details>
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'DonationEmbed' || block.type === 'Embed'" class="donate">
      <div class="wrap">
        <h2 v-if="p.heading || p.title" class="sb-inline" contenteditable="true" @blur="onInline(p.heading ? 'heading' : 'title', $event)">{{ String(p.heading ?? p.title ?? '') }}</h2>
        <div class="donate-box">
          <p class="embed-fallback">The form or embed shows here when the page is live.</p>
        </div>
      </div>
    </section>

    <section v-else-if="block.type === 'ImpactTiers'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <p v-if="p.intro" class="lede sb-inline" contenteditable="true" @blur="onInline('intro', $event)">{{ String(p.intro) }}</p>
        <div class="tiers">
          <article v-for="(item, i) in asItems<{ amount: string; title?: string; explanation?: string; frequency?: string; image?: ImageRef }>(p.items)" :key="i" class="tier">
            <a class="tier-give" href="#donate">
              <img v-if="item.image" :src="imageSrc(item.image, 640)" :alt="item.image.alt ?? ''" @error="($event.target as HTMLImageElement).style.opacity = '0.2'">
              <div class="tier-body">
                <p class="tier-amount">{{ item.amount }}</p>
                <h3 v-if="item.title">{{ item.title }}</h3>
                <p v-if="item.explanation">{{ item.explanation }}</p>
                <p v-if="item.frequency" class="tier-frequency">{{ item.frequency === 'once' ? 'One-time' : item.frequency }}</p>
              </div>
            </a>
          </article>
        </div>
        <p v-if="p.otherAmount" class="tier-other">{{ String(p.otherAmount) }}</p>
        <a v-if="asLink(p.cta)" class="btn" :href="asLink(p.cta)!.href" @click.prevent>{{ asLink(p.cta)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'DonationProgress'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <progress class="goal-progress" max="100" :value="progressValue(p.raised, p.goal)">{{ progressValue(p.raised, p.goal) }}%</progress>
        <p class="progress-meta">{{ String(p.currency ?? '') }}{{ String(p.raised ?? '') }} {{ String(p.label || 'raised so far') }} of {{ String(p.currency ?? '') }}{{ String(p.goal ?? '') }}</p>
        <p v-if="p.matchLine" class="progress-match">{{ String(p.matchLine) }}</p>
        <p v-if="p.endDate" class="progress-date">Until {{ String(p.endDate) }}</p>
        <a v-if="asLink(p.cta)" class="btn" :href="asLink(p.cta)!.href" @click.prevent>{{ asLink(p.cta)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'MatchBanner'" class="match-banner" :class="`tone-${String(p.tone ?? 'neutral')}`">
      <div class="wrap">
        <p class="match-message sb-inline" contenteditable="true" @blur="onInline('message', $event)">{{ String(p.message ?? '') }}</p>
        <p v-if="p.matchLine" class="match-line">{{ String(p.matchLine) }}</p>
        <p v-if="p.endDate" class="match-countdown">Until {{ String(p.endDate) }}</p>
        <a v-if="asLink(p.cta)" class="btn" :href="asLink(p.cta)!.href" @click.prevent>{{ asLink(p.cta)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'StoryBeforeAfter'" class="section">
      <div class="wrap">
        <p v-if="p.eyebrow" class="eyebrow">{{ String(p.eyebrow) }}</p>
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <div class="prose">
          <EditorRichTextView :doc="p.content" />
        </div>
        <div class="before-after">
          <figure>
            <img v-if="asImage(p.before)" :src="imageSrc(asImage(p.before), 960)" :alt="asImage(p.before)?.alt ?? ''" @error="($event.target as HTMLImageElement).style.opacity = '0.2'">
            <figcaption>{{ String(p.beforeCaption ?? 'Before') }}</figcaption>
          </figure>
          <figure>
            <img v-if="asImage(p.after)" :src="imageSrc(asImage(p.after), 960)" :alt="asImage(p.after)?.alt ?? ''" @error="($event.target as HTMLImageElement).style.opacity = '0.2'">
            <figcaption>{{ String(p.afterCaption ?? 'After') }}</figcaption>
          </figure>
        </div>
        <blockquote v-if="p.quote" class="quote">
          <p>{{ String(p.quote) }}</p>
          <footer v-if="p.attribution">{{ String(p.attribution) }}</footer>
        </blockquote>
        <a v-if="asLink(p.cta)" class="btn" :href="asLink(p.cta)!.href" @click.prevent>{{ asLink(p.cta)!.label }}</a>
      </div>
    </section>

    <section v-else-if="block.type === 'TrustStrip'" class="section">
      <div class="wrap">
        <h2 v-if="p.heading" class="sb-inline" contenteditable="true" @blur="onInline('heading', $event)">{{ String(p.heading) }}</h2>
        <p v-if="p.intro" class="lede">{{ String(p.intro) }}</p>
        <div class="trust-groups">
          <div v-for="(group, gi) in trustGroups(p.items)" :key="gi" class="trust-group">
            <h3 v-if="group.label" class="trust-group-label">{{ group.label }}</h3>
            <ul class="trust-strip">
              <li v-for="(item, i) in group.items" :key="i" class="trust-item">
                <p v-if="item.badgeHtml" class="trust-note">A badge snippet will appear on the published page.</p>
                <img v-if="item.logo" :src="imageSrc(item.logo, 640)" :alt="item.logo.alt ?? item.name" class="trust-logo" @error="($event.target as HTMLImageElement).style.opacity = '0.2'">
                <span class="trust-name">{{ item.name }}</span>
                <span v-if="item.note" class="trust-note">{{ item.note }}</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section v-else class="section">
      <div class="wrap">
        <p>{{ block.type }}</p>
      </div>
    </section>
  </div>
</template>
