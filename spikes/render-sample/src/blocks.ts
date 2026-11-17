// "Compiled" block render functions: the shape ADR 0004 describes after the Vite compile step.
// Written by hand for the spike, using Vue's h() so we can call renderToString without a bundler.
import { defineComponent, h, type VNode } from 'vue'
import { samplePage, siteShell } from './sample'

type Block = (typeof samplePage.blocks)[number]

const VideoHero = defineComponent({
  name: 'VideoHero',
  props: ['heading', 'subheading', 'video', 'poster', 'poster640', 'poster640Webp', 'cta'],
  setup(props) {
    return () =>
      h('section', { class: 'hero', 'aria-label': props.heading }, [
        h('picture', { class: 'hero-media' }, [
          props.poster640 ? h('source', { type: 'image/avif', srcset: props.poster640, media: '(max-width: 640px)' }) : null,
          props.poster640Webp ? h('source', { type: 'image/webp', srcset: props.poster640Webp, media: '(max-width: 640px)' }) : null,
          h('img', { class: 'hero-poster', src: props.poster, alt: '', width: 1280, height: 720, decoding: 'async' }),
        ]),
        h(
          'video',
          {
            class: 'hero-video',
            autoplay: true,
            muted: true,
            loop: true,
            playsinline: true,
            preload: 'none',
            poster: props.poster,
            'aria-hidden': 'true',
          },
          [h('source', { src: props.video, type: 'video/mp4' })],
        ),
        h('div', { class: 'hero-inner' }, [
          h('h1', props.heading),
          props.subheading ? h('p', props.subheading) : null,
          props.cta ? h('a', { class: 'btn', href: props.cta.href }, props.cta.label) : null,
        ]),
      ])
  },
})

const RichText = defineComponent({
  name: 'RichText',
  props: ['heading', 'paragraphs'],
  setup(props) {
    return () =>
      h('section', { class: 'section' }, [
        h('div', { class: 'wrap prose' }, [
          props.heading ? h('h2', props.heading) : null,
          ...(props.paragraphs as string[]).map((p) => h('p', p)),
        ]),
      ])
  },
})

const Quote = defineComponent({
  name: 'Quote',
  props: ['text', 'attribution'],
  setup(props) {
    return () =>
      h('section', { class: 'section' }, [
        h('div', { class: 'wrap' }, [
          h('blockquote', { class: 'quote' }, [
            h('p', props.text),
            props.attribution ? h('footer', props.attribution) : null,
          ]),
        ]),
      ])
  },
})

const DonationEmbed = defineComponent({
  name: 'DonationEmbed',
  props: ['heading', 'anchor', 'vform', 'orgId', 'scriptSrc', 'fallbackHref'],
  setup(props) {
    return () =>
      h('section', { class: 'donate', id: props.anchor }, [
        h('div', { class: 'wrap' }, [
          h('h2', props.heading),
          h(
            'div',
            {
              class: 'donate-box',
              'data-embed': 'virtuous',
              'data-src': props.scriptSrc,
              'data-vform': props.vform,
              'data-org-id': props.orgId,
            },
            [
              h('p', { class: 'embed-fallback' }, [
                'The donation form loads here when the page is live. ',
                h('a', { href: props.fallbackHref }, 'Donate on our giving page'),
                ' if it does not appear.',
              ]),
            ],
          ),
        ]),
      ])
  },
})

const BLOCKS: Record<string, ReturnType<typeof defineComponent>> = { VideoHero, RichText, Quote, DonationEmbed }

const Page = defineComponent({
  name: 'Page',
  setup() {
    return () =>
      h('div', [
        h('a', { class: 'skip', href: '#main' }, 'Skip to content'),
        h('header', { class: 'site-header' }, [
          h('a', { href: '/' }, siteShell.name),
          h(
            'nav',
            { class: 'nav', 'aria-label': 'Site' },
            siteShell.headerLinks.map((l) => h('a', { href: l.href }, l.label)),
          ),
        ]),
        h(
          'main',
          { id: 'main' },
          samplePage.blocks.map((block) => renderBlock(block)),
        ),
        h('footer', { class: 'site-footer' }, siteShell.footer),
      ])
  },
})

function renderBlock(block: Block): VNode {
  const comp = BLOCKS[block.type]
  if (!comp) throw new Error(`Unknown block ${block.type}`)
  return h(comp, block.props)
}

export { Page, BLOCKS }
