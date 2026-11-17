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

    <section v-else class="section">
      <div class="wrap">
        <p>{{ block.type }}</p>
      </div>
    </section>
  </div>
</template>
