import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { css } from '@codemirror/lang-css'
import { markdown } from '@codemirror/lang-markdown'
import { EditorState, Prec, type Extension } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

export type EditorLanguage = 'text' | 'markdown' | 'css'

/** Markdown and CSS get one language extension. Plain text gets none. */
export function languageSupport(language: EditorLanguage): Extension | null {
  if (language === 'markdown') return markdown()
  if (language === 'css') return css()
  return null
}

/** True when `next` fits the raw character cap. No cap means every edit fits. */
export function withinMaxLength(next: string, max: number | undefined): boolean {
  if (max === undefined) return true
  return next.length <= max
}

export interface CodeMirrorHandle {
  destroy: () => void
  /** Replace the doc when it differs. An equal value is ignored so parent and editor do not loop. */
  setValue: (value: string) => void
  focus: () => void
  length: () => number
}

export interface MountCodeMirrorOptions {
  parent: HTMLElement
  value: string
  language: EditorLanguage
  readonly?: boolean
  /** Raw character cap. Over-cap transactions are dropped. The initial doc is not filtered. */
  maxLength?: number
  onChange: (value: string) => void
  onEscape: () => void
}

/**
 * Mount a CodeMirror view.
 * Escape is handled only by a high-precedence keymap: it preventDefault and returns true.
 * Autocomplete and search are not loaded, so they cannot also handle Escape.
 */
export function mountCodeMirror(opts: MountCodeMirrorOptions): CodeMirrorHandle {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    Prec.highest(
      keymap.of([
        {
          key: 'Escape',
          preventDefault: true,
          stopPropagation: true,
          run() {
            opts.onEscape()
            return true
          },
        },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) opts.onChange(update.state.doc.toString())
    }),
  ]
  const language = languageSupport(opts.language)
  if (language) extensions.push(language)
  if (opts.readonly) extensions.push(EditorState.readOnly.of(true))
  if (opts.maxLength !== undefined) {
    const max = opts.maxLength
    extensions.push(
      EditorState.transactionFilter.of((tr) => {
        if (!tr.docChanged) return tr
        return withinMaxLength(tr.newDoc.toString(), max) ? tr : []
      }),
    )
  }

  const view = new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.value, extensions }),
  })

  return {
    destroy: () => view.destroy(),
    setValue(value) {
      const current = view.state.doc.toString()
      if (value === current) return
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } })
    },
    focus: () => view.focus(),
    length: () => view.state.doc.length,
  }
}
