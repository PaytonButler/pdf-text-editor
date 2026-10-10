
import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ChangeEvent,
  DragEvent,
  PointerEvent,
  MouseEvent,
} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

type Tool = 'select' | 'text'

type TextBox = {
  id: number
  x: number
  y: number
  text: string
  fontSize: number
}

type DragStart = {
  id: number
  pointerX: number
  pointerY: number
  boxX: number
  boxY: number
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const nextTextBoxId = useRef(1)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([])
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null)
  const [dragStart, setDragStart] = useState<DragStart | null>(null)

  const addTextBox = useCallback((x?: number, y?: number) => {
    const id = nextTextBoxId.current++
    const offset = (id - 1) % 10

    const newBox: TextBox = {
      id,
      x: Math.max(0, Math.min(85, x ?? 8 + offset * 3)),
      y: Math.max(0, Math.min(90, y ?? 8 + offset * 4)),
      text: '',
      fontSize: 15,
    }

    setTextBoxes((current) => [...current, newBox])
    setSelectedBoxId(id)
  }, [])

  // Alt+T is the reliable shortcut. Ctrl/Cmd+T is also intercepted
  // where the browser permits websites to handle it.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()

      const isTextShortcut =
        (event.ctrlKey || event.metaKey) && key === 't'

      const isAlternativeShortcut =
        event.altKey && !event.ctrlKey && !event.metaKey && key === 't'

      if (isTextShortcut || isAlternativeShortcut) {
        event.preventDefault()
        event.stopPropagation()
        addTextBox()
      }

      if (event.key === 'Escape') {
        setSelectedBoxId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [addTextBox])

  function loadFile(file: File | undefined) {
    if (!file) return

    if (
      file.type !== 'application/pdf' &&
      !file.name.toLowerCase().endsWith('.pdf')
    ) {
      setError('Please select a PDF file.')
      return
    }

    setError('')
    setSelectedFile(file)
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    loadFile(event.target.files?.[0])
    event.target.value = ''
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragging(false)
    loadFile(event.dataTransfer.files[0])
  }

  function openFilePicker() {
    fileInputRef.current?.click()
  }

  function handlePageClick(event: MouseEvent<HTMLDivElement>) {
    if (activeTool !== 'text') return

    const target = event.target as HTMLElement

    if (target.closest('.text-box')) return

    const page = pageRef.current
    if (!page) return

    const rect = page.getBoundingClientRect()

    const x = ((event.clientX - rect.left) / rect.width) * 100
    const y = ((event.clientY - rect.top) / rect.height) * 100

    addTextBox(x, y)
  }

  function handleDragStart(
    event: PointerEvent<HTMLDivElement>,
    box: TextBox,
  ) {
    event.preventDefault()
    event.stopPropagation()

    event.currentTarget.setPointerCapture(event.pointerId)

    setSelectedBoxId(box.id)
    setDragStart({
      id: box.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      boxX: box.x,
      boxY: box.y,
    })
  }

  function handleDragMove(
    event: PointerEvent<HTMLDivElement>,
    boxId: number,
  ) {
    if (!dragStart || dragStart.id !== boxId) return

    const page = pageRef.current
    if (!page) return

    const rect = page.getBoundingClientRect()

    const deltaX = ((event.clientX - dragStart.pointerX) / rect.width) * 100
    const deltaY = ((event.clientY - dragStart.pointerY) / rect.height) * 100

    setTextBoxes((current) =>
      current.map((box) =>
        box.id === boxId
          ? {
            ...box,
            x: Math.max(0, Math.min(85, dragStart.boxX + deltaX)),
            y: Math.max(0, Math.min(95, dragStart.boxY + deltaY)),
          }
          : box,
      ),
    )
  }

  function updateTextBox(id: number, text: string) {
    setTextBoxes((current) =>
      current.map((box) =>
        box.id === id ? { ...box, text } : box,
      ),
    )
  }

  function deleteTextBox(id: number) {
    setTextBoxes((current) => current.filter((box) => box.id !== id))

    if (selectedBoxId === id) {
      setSelectedBoxId(null)
    }

    if (dragStart?.id === id) {
      setDragStart(null)
    }
  }

  useEffect(() => {
    setTextBoxes([])
    setSelectedBoxId(null)
    setDragStart(null)
    nextTextBoxId.current = 1
  }, [selectedFile])

  useEffect(() => {
    if (!selectedFile) {
      setPageCount(0)
      setRenderError('')
      return
    }

    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined

    async function renderPdf() {
      try {
        setRenderError('')
        setPageCount(0)

        const file = selectedFile
        if (!file) return

        const bytes = new Uint8Array(await file.arrayBuffer())

        if (cancelled) return

        loadingTask = pdfjsLib.getDocument({ data: bytes })
        const pdf = await loadingTask.promise

        if (cancelled) return

        setPageCount(pdf.numPages)

        const page = await pdf.getPage(1)

        if (cancelled) return

        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')

        if (!canvas || !context) {
          throw new Error('Could not create the PDF canvas.')
        }

        const viewport = page.getViewport({ scale: 1.25 })

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        await page.render({
          canvas,
          canvasContext: context,
          viewport,
        }).promise
      } catch (err) {
        if (!cancelled) {
          console.error('PDF rendering failed:', err)
          setRenderError(
            'Could not display this PDF. Try another PDF file.',
          )
        }
      }
    }

    void renderPdf()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [selectedFile])

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Pagecraft home">
          <span className="brand-icon">P</span>
          <span>pagecraft</span>
        </a>

        <div className="topbar-center">
          <span className="document-name">
            {selectedFile ? selectedFile.name : 'Untitled document'}
          </span>
          <span className="save-status">
            <span className="status-dot" />
            {selectedFile ? 'PDF loaded locally' : 'Ready to start'}
          </span>
        </div>

        <button
          className="button button-primary"
          onClick={openFilePicker}
        >
          <span aria-hidden="true">↑</span>
          Open PDF
        </button>

        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept="application/pdf,.pdf"
          onChange={handleFileChange}
        />
      </header>

      <div className="editor-layout">
        <aside className="sidebar">
          <div className="sidebar-heading">TOOLS</div>

          <button
            className={`tool-button ${activeTool === 'select' ? 'active' : ''}`}
            onClick={() => setActiveTool('select')}
            aria-pressed={activeTool === 'select'}
          >
            <span className="tool-icon" aria-hidden="true">↖</span>
            <span>Select</span>
            <span className="tool-shortcut">V</span>
          </button>

          <button
            className={`tool-button ${activeTool === 'text' ? 'active' : ''}`}
            onClick={() => setActiveTool('text')}
            aria-pressed={activeTool === 'text'}
          >
            <span className="tool-icon text-icon" aria-hidden="true">T</span>
            <span>Add text</span>
            <span className="tool-shortcut">Alt T</span>
          </button>

          <div className="sidebar-divider" />

          <div className="sidebar-heading">DOCUMENT</div>

          <div className="sidebar-info">
            <span className="info-icon" aria-hidden="true">▤</span>
            <div>
              <strong>
                {selectedFile ? 'PDF selected' : 'No document'}
              </strong>
              <p>
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                  : 'Upload a PDF to begin'}
              </p>
              {selectedFile && (
                <p>
                  {textBoxes.length} text box
                  {textBoxes.length === 1 ? '' : 'es'}
                </p>
              )}
            </div>
          </div>

          <div className="sidebar-tip">
            <span aria-hidden="true">✳</span>
            <strong>Quick tip</strong>
            <p>
              {activeTool === 'text'
                ? 'Click the page to place text. Press Alt + T to create more boxes.'
                : 'Choose Add text to place text on your document.'}
            </p>
          </div>
        </aside>

        <section className="workspace">
          <div className="workspace-toolbar">
            <div className="workspace-breadcrumb">
              <span>Workspace</span>
              <span className="breadcrumb-separator">/</span>
              <strong>
                {selectedFile ? selectedFile.name : 'No document open'}
              </strong>
            </div>

            <div className="zoom-control">
              <span>−</span>
              <span>100%</span>
              <span>+</span>
            </div>
          </div>

          <div
            className={`canvas-area ${isDragging ? 'dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={(event) => {
              if (
                !event.currentTarget.contains(
                  event.relatedTarget as Node | null,
                )
              ) {
                setIsDragging(false)
              }
            }}
            onDrop={handleDrop}
          >
            {selectedFile ? (
              <div className="pdf-viewer">
                {renderError ? (
                  <div className="pdf-render-error" role="alert">
                    {renderError}
                  </div>
                ) : (
                  <>
                    <div
                      ref={pageRef}
                      className="pdf-page"
                      onClick={handlePageClick}
                    >
                      <canvas
                        ref={canvasRef}
                        className="pdf-canvas"
                        aria-label="First page of the selected PDF"
                      />

                      <div className="text-box-layer">
                        {textBoxes.map((box) => (
                          <div
                            key={box.id}
                            className={`text-box ${selectedBoxId === box.id ? 'selected' : ''}`}
                            style={{
                              left: `${box.x}%`,
                              top: `${box.y}%`,
                            }}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedBoxId(box.id)
                            }}
                          >
                            <div
                              className="text-box-drag-handle"
                              title="Drag to move this text box"
                              onPointerDown={(event) =>
                                handleDragStart(event, box)
                              }
                              onPointerMove={(event) =>
                                handleDragMove(event, box.id)
                              }
                              onPointerUp={() => setDragStart(null)}
                              onPointerCancel={() => setDragStart(null)}
                            />

                            <button
                              type="button"
                              className="text-box-delete"
                              aria-label={`Delete text box ${box.id}`}
                              title="Delete text box"
                              onClick={(event) => {
                                event.stopPropagation()
                                deleteTextBox(box.id)
                              }}
                            >
                              ×
                            </button>

                            <textarea
                              className="text-box-input"
                              aria-label={`Text box ${box.id} content`}
                              placeholder="Type here..."
                              value={box.text}
                              rows={2}
                              style={{ fontSize: `${box.fontSize}px` }}
                              onFocus={() => setSelectedBoxId(box.id)}
                              onChange={(event) =>
                                updateTextBox(box.id, event.target.value)
                              }
                            />
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pdf-page-label">
                      {pageCount > 0
                        ? `Page 1 of ${pageCount}`
                        : 'Loading PDF...'}
                    </div>
                  </>
                )}

                <button
                  className="button button-secondary"
                  onClick={openFilePicker}
                >
                  Choose another PDF
                </button>
              </div>
            ) : (
              <div className="upload-card">
                <div className="upload-icon">
                  <svg
                    viewBox="0 0 48 48"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 5.5h16l9 9v27H12a3 3 0 0 1-3-3v-30a3 3 0 0 1 3-3Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M28 5.5v10h9M24 33V21m-5 5 5-5 5 5"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>

                <h1>Your PDF, your way.</h1>
                <p className="upload-description">
                  Add text anywhere on your document.
                  <br />
                  Simple, fast, and entirely in your browser.
                </p>

                <button
                  className="button button-primary upload-button"
                  onClick={openFilePicker}
                >
                  <span aria-hidden="true">↑</span>
                  Choose a PDF
                </button>

                <p className="file-hint">
                  or drag and drop a PDF here
                </p>

                {isDragging && (
                  <p className="drop-message">
                    Drop your PDF to open it
                  </p>
                )}

                <div className="privacy-note">
                  <span aria-hidden="true">♧</span>
                  Your files stay on your device
                </div>
              </div>
            )}

            {error && (
              <div className="error-message" role="alert">
                {error}
              </div>
            )}
          </div>

          <footer className="statusbar">
            <span>
              <span className="status-dot" />
              All changes stay local
            </span>
            <span>PDF Text Editor · Preview build</span>
          </footer>
        </section>
      </div>
    </main>
  )
}

export default App
