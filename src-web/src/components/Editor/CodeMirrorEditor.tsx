import { useEffect, useRef, useCallback } from 'react'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { defaultKeymap, indentWithTab, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { syntaxHighlighting, indentOnInput, bracketMatching, foldGutter, foldKeymap } from '@codemirror/language'
import { defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { tags } from '@lezer/highlight'

interface CodeMirrorEditorProps {
  content: string
  onChange: (content: string) => void
  onPasteImage?: (file: File) => void
}

// Catppuccin Mocha inspired theme
const catppuccinTheme = EditorView.theme({
  '&': {
    backgroundColor: 'transparent',
    color: '#cdd6f4',
    fontSize: 'var(--editor-font-size, 15px)',
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
  },
  '.cm-content': {
    caretColor: '#f5e0dc',
    lineHeight: '1.6',
    padding: '16px 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: '#f5e0dc',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: '#45475a',
  },
  '.cm-panels': {
    backgroundColor: '#181825',
    color: '#cdd6f4',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid #313244',
  },
  '.cm-panels.cm-panels-bottom': {
    borderTop: '1px solid #313244',
  },
  '.cm-searchMatch': {
    backgroundColor: '#f9e2af33',
    outline: '1px solid #f9e2af66',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: '#f9e2af66',
  },
  '.cm-activeLine': {
    backgroundColor: '#31324480',
  },
  '.cm-selectionMatch': {
    backgroundColor: '#45475a66',
  },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: '#45475a',
    outline: '1px solid #585b70',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: '#6c7086',
    border: 'none',
    paddingLeft: '8px',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#cba6f7',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: '#313244',
    color: '#6c7086',
    border: 'none',
  },
  '.cm-tooltip': {
    border: '1px solid #45475a',
    backgroundColor: '#1e1e2e',
  },
  '.cm-tooltip .cm-tooltip-arrow:before': {
    borderTopColor: '#45475a',
    borderBottomColor: '#45475a',
  },
  '.cm-tooltip .cm-tooltip-arrow:after': {
    borderTopColor: '#1e1e2e',
    borderBottomColor: '#1e1e2e',
  },
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: '#45475a',
      color: '#cdd6f4',
    },
  },
}, { dark: true })

// Syntax highlighting for Markdown
const catppuccinHighlighting = HighlightStyle.define([
  { tag: tags.heading1, color: '#cba6f7', fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, color: '#cba6f7', fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, color: '#cba6f7', fontWeight: 'bold', fontSize: '1.1em' },
  { tag: tags.heading4, color: '#cba6f7', fontWeight: 'bold' },
  { tag: tags.heading5, color: '#cba6f7', fontWeight: 'bold' },
  { tag: tags.heading6, color: '#cba6f7', fontWeight: 'bold' },
  { tag: tags.emphasis, color: '#f9e2af', fontStyle: 'italic' },
  { tag: tags.strong, color: '#fab387', fontWeight: 'bold' },
  { tag: tags.strikethrough, color: '#6c7086', textDecoration: 'line-through' },
  { tag: tags.link, color: '#89b4fa', textDecoration: 'underline' },
  { tag: tags.url, color: '#94e2d5' },
  { tag: tags.monospace, color: '#a6e3a1', backgroundColor: '#31324480', borderRadius: '3px', padding: '1px 3px' },
  { tag: tags.comment, color: '#6c7086' },
  { tag: tags.meta, color: '#6c7086' },
  { tag: tags.keyword, color: '#cba6f7' },
  { tag: tags.string, color: '#a6e3a1' },
  { tag: tags.number, color: '#fab387' },
  { tag: tags.bool, color: '#fab387' },
  { tag: tags.null, color: '#fab387' },
  { tag: tags.operator, color: '#89dceb' },
  { tag: tags.separator, color: '#6c7086' },
  { tag: tags.quote, color: '#6c7086', fontStyle: 'italic' },
  { tag: tags.list, color: '#f38ba8' },
])

export default function CodeMirrorEditor({ content, onChange, onPasteImage }: CodeMirrorEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)

  // Keep onChange ref current so the update listener always calls the latest callback
  useEffect(() => { onChangeRef.current = onChange }, [onChange])

  // Handle paste events for images
  const handlePaste = useCallback((e: ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items || !onPasteImage) return

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault()
        const file = item.getAsFile()
        if (file) {
          onPasteImage(file)
        }
        return
      }
    }
  }, [onPasteImage])

  // Initialize CodeMirror
  useEffect(() => {
    if (!editorRef.current) return

    const state = EditorState.create({
      doc: content,
      extensions: [
        // Line numbers and active line
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        
        // History (undo/redo)
        history(),
        
        // Fold gutter
        foldGutter(),
        
        // Indentation
        indentOnInput(),
        bracketMatching(),
        closeBrackets(),
        
        // Selection highlighting
        highlightSelectionMatches(),
        
        // Markdown language support
        markdown({ base: markdownLanguage }),
        
        // Autocompletion
        autocompletion(),
        
        // Syntax highlighting
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        syntaxHighlighting(catppuccinHighlighting),
        
        // Theme
        catppuccinTheme,
        
        // Keymaps
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...searchKeymap,
          ...completionKeymap,
          ...closeBracketsKeymap,
          indentWithTab,
        ]),
        
        // Update listener - uses ref to always call the latest onChange
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        }),
        
        // Paste handler
        EditorView.domEventHandlers({
          paste: handlePaste,
        }),
        
        // Line wrapping
        EditorView.lineWrapping,
      ],
    })

    const view = new EditorView({
      state,
      parent: editorRef.current,
    })

    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
    }
  }, []) // Empty deps - only run once

  // Update content when it changes externally
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentContent = view.state.doc.toString()
    if (currentContent !== content) {
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      })
    }
  }, [content]) // Sync when content prop changes (e.g. tab switch)

  return (
    <div 
      ref={editorRef} 
      className="h-full w-full overflow-hidden codemirror-editor"
      style={{
        minHeight: 'calc(100vh - 120px)',
      }}
    />
  )
}
