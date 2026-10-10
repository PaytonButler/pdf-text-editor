import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type {
  ChangeEvent,
  DragEvent,
  PointerEvent,
  MouseEvent,
} from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

type Tool = 'select' | 'text'

type TextBox = {
  id: number
  pageNumber: number
  x: number
  y: number
  width: number
  height: number
  text: string
  fontSize: number
  activated: boolean
}

type DragStart = {
  id: number
  pageNumber: number
  pointerX: number
  pointerY: number
  boxX: number
  boxY: number
}

type ResizeStart = {
  id: number
  pageNumber: number
  pointerX: number
  pointerY: number
  width: number
  height: number
}

type PdfPageProps = {
  pdf: pdfjsLib.PDFDocumentProxy
  pageNumber: number
  onPageReady: (pageNumber: number, width: number, height: number) => void
}

function PdfPageCanvas({ pdf, pageNumber, onPageReady }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [renderError, setRenderError] = useState('')

  useEffect(() => {
    let cancelled = false
    let renderTask: pdfjsLib.RenderTask | undefined

    async function renderPage() {
      try {
        setRenderError('')

        const page = await pdf.getPage(pageNumber)
        if (cancelled) return

        const scale = 1.25
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        const context = canvas?.getContext('2d')

        if (!canvas || !context) {
          throw new Error('Could not create the PDF canvas.')
        }

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        onPageReady(pageNumber, viewport.width, viewport.height)

        renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
        })

        await renderTask.promise
      } catch (error) {
        if (!cancelled) {
          console.error(`Could not render PDF page ${pageNumber}:`, error)
          setRenderError('This page could not be displayed.')
        }
      }
    }

    void renderPage()

    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [pdf, pageNumber, onPageReady])

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pdf-canvas"
        aria-label={`PDF page ${pageNumber}`}
      />
      {renderError && (
        <div className="page-render-error">{renderError}</div>
      )}
    </>
  )
}

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nextTextBoxId = useRef(1)
  const pageElements = useRef<Map<number, HTMLDivElement>>(new Map())
  const pageNavigationInput = useRef<HTMLInputElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [pdfDocument, setPdfDocument] =
    useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [pageCount, setPageCount] = useState(0)
  const [textBoxes, setTextBoxes] = useState<TextBox[]>([])
  const [selectedBoxId, setSelectedBoxId] = useState<number | null>(null)
  const [dragStart, setDragStart] = useState<DragStart | null>(null)
  const [resizeStart, setResizeStart] = useState<ResizeStart | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [pageToJump, setPageToJump] = useState('1')
  const [pageDimensions, setPageDimensions] = useState<
    Record<number, { width: number; height: number }>
  >({})

  const addTextBox = useCallback(
    (pageNumber: number, x?: number, y?: number) => {
      const id = nextTextBoxId.current++
      const offset = (id - 1) % 10

      const newBox: TextBox = {
        id,
        pageNumber,
        x: Math.max(0, Math.min(85, x ?? 8 + offset * 3)),
        y: Math.max(0, Math.min(90, y ?? 8 + offset * 4)),
        width: 190,
        height: 58,
        text: '',
        fontSize: 15,
        activated: false,
      }

      setTextBoxes((current) => [...current, newBox])
      setSelectedBoxId(id)
    },
    [],
  )

  const registerPageElement = useCallback(
    (pageNumber: number, element: HTMLDivElement | null) => {
      if (element) {
        pageElements.current.set(pageNumber, element)
      } else {
        pageElements.current.delete(pageNumber)
      }
    },
    [],
  )

  const handlePageReady = useCallback(
    (pageNumber: number, width: number, height: number) => {
      setPageDimensions((current) => {
        const previous = current[pageNumber]

        if (previous?.width === width && previous?.height === height) {
          return current
        }

        return {
          ...current,
          [pageNumber]: { width, height },
        }
      })
    },
    [],
  )

  useEffect(() => {
    function getVisiblePageNumber() {
      const viewportCenter = window.innerHeight / 2
      let closestPage = 1
      let closestDistance = Number.POSITIVE_INFINITY

      for (const [pageNumber, element] of pageElements.current.entries()) {
        const rect = element.getBoundingClientRect()
        const distance = Math.abs(
          (rect.top + rect.bottom) / 2 - viewportCenter,
        )

        if (distance < closestDistance) {
          closestDistance = distance
          closestPage = pageNumber
        }
      }

      return closestPage
    }

    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const target = event.target as HTMLElement | null

      const isTyping =
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'INPUT' ||
        target?.isContentEditable

      const ctrlT = (event.ctrlKey || event.metaKey) && key === 't'
      const altT =
        event.altKey && !event.ctrlKey && !event.metaKey && key === 't'

      if ((ctrlT || altT) && !isTyping && selectedFile) {
        event.preventDefault()
        event.stopPropagation()

        const pageNumber = getVisiblePageNumber()
        addTextBox(pageNumber)
      }

      if (event.key === 'Escape') {
        setSelectedBoxId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [addTextBox, selectedFile])

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
    setRenderError('')
    setSelectedFile(file)
    setPdfDocument(null)
    setPageCount(0)
    setPageDimensions({})
    setPageToJump('1')
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

  useEffect(() => {
    if (!selectedFile) {
      setPdfDocument(null)
      setPageCount(0)
      return
    }

    const file = selectedFile
    let cancelled = false
    let loadingTask: ReturnType<typeof pdfjsLib.getDocument> | undefined

    async function loadPdf() {
      try {
        setRenderError('')

        const bytes = new Uint8Array(await file.arrayBuffer())
        if (cancelled) return

        loadingTask = pdfjsLib.getDocument({ data: bytes })

        const pdf = await loadingTask.promise
        if (cancelled) return

        setPdfDocument(pdf)
        setPageCount(pdf.numPages)
        setPageToJump('1')
      } catch (loadError) {
        if (!cancelled) {
          console.error('PDF loading failed:', loadError)
          setRenderError('Could not open this PDF. Try another PDF file.')
        }
      }
    }

    void loadPdf()

    return () => {
      cancelled = true
      void loadingTask?.destroy()
    }
  }, [selectedFile])

  useEffect(() => {
    setTextBoxes([])
    setSelectedBoxId(null)
    setDragStart(null)
    setResizeStart(null)
    nextTextBoxId.current = 1
  }, [selectedFile])

  function handlePageClick(
    pageNumber: number,
    event: MouseEvent<HTMLDivElement>,
  ) {
    if (activeTool !== 'text') return

    const target = event.target as HTMLElement
    if (target.closest('.text-box')) return

    const page = pageElements.current.get(pageNumber)
    if (!page) return

    const rect = page.getBoundingClientRect()

    addTextBox(
      pageNumber,
      ((event.clientX - rect.left) / rect.width) * 100,
      ((event.clientY - rect.top) / rect.height) * 100,
    )
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
      pageNumber: box.pageNumber,
      pointerX: event.clientX,
      pointerY: event.clientY,
      boxX: box.x,
      boxY: box.y,
    })
  }

  function handleDragMove(
    event: PointerEvent<HTMLDivElement>,
    box: TextBox,
  ) {
    if (!dragStart || dragStart.id !== box.id) return

    const page = pageElements.current.get(box.pageNumber)
    if (!page) return

    const rect = page.getBoundingClientRect()
    const deltaX =
      ((event.clientX - dragStart.pointerX) / rect.width) * 100
    const deltaY =
      ((event.clientY - dragStart.pointerY) / rect.height) * 100

    setTextBoxes((current) =>
      current.map((item) => {
        if (item.id !== box.id) return item

        return {
          ...item,
          x: Math.max(
            0,
            Math.min(
              100 - (item.width / rect.width) * 100,
              dragStart.boxX + deltaX,
            ),
          ),
          y: Math.max(
            0,
            Math.min(
              100 - (item.height / rect.height) * 100,
              dragStart.boxY + deltaY,
            ),
          ),
        }
      }),
    )
  }

  function handleResizeStart(
    event: PointerEvent<HTMLDivElement>,
    box: TextBox,
  ) {
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    setSelectedBoxId(box.id)

    setResizeStart({
      id: box.id,
      pageNumber: box.pageNumber,
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: box.width,
      height: box.height,
    })
  }

  function handleResizeMove(
    event: PointerEvent<HTMLDivElement>,
    box: TextBox,
  ) {
    if (!resizeStart || resizeStart.id !== box.id) return

    const page = pageElements.current.get(box.pageNumber)
    if (!page) return

    const rect = page.getBoundingClientRect()

    setTextBoxes((current) =>
      current.map((item) => {
        if (item.id !== box.id) return item

        return {
          ...item,
          width: Math.max(
            90,
            Math.min(
              rect.width * 0.8,
              resizeStart.width + event.clientX - resizeStart.pointerX,
            ),
          ),
          height: Math.max(
            38,
            Math.min(
              rect.height,
              resizeStart.height + event.clientY - resizeStart.pointerY,
            ),
          ),
        }
      }),
    )
  }

  function updateTextBox(id: number, text: string) {
    setTextBoxes((current) =>
      current.map((box) =>
        box.id === id ? { ...box, text, activated: true } : box,
      ),
    )
  }

  function activateTextBox(id: number) {
    setSelectedBoxId(id)

    setTextBoxes((current) =>
      current.map((box) =>
        box.id === id ? { ...box, activated: true } : box,
      ),
    )
  }

  function deleteTextBox(id: number) {
    setTextBoxes((current) => current.filter((box) => box.id !== id))

    if (selectedBoxId === id) setSelectedBoxId(null)
    if (dragStart?.id === id) setDragStart(null)
    if (resizeStart?.id === id) setResizeStart(null)
  }

  function jumpToPage() {
    const parsed = Number.parseInt(pageToJump, 10)

    if (!Number.isFinite(parsed) || parsed < 1 || parsed > pageCount) {
      setError(`Enter a page number from 1 to ${pageCount}.`)
      return
    }

    setError('')
    pageElements.current
      .get(parsed)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  async function exportPdf() {
    const file = selectedFile
    if (!file || isExporting) return

    setIsExporting(true)
    setError('')

    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const pdfDoc = await PDFDocument.load(bytes)
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica)

      for (const box of textBoxes) {
        if (!box.text.trim()) continue

        const page = pdfDoc.getPage(box.pageNumber - 1)
        const pageElement = pageElements.current.get(box.pageNumber)
        if (!pageElement) continue

        const rect = pageElement.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) continue

        const pageSize = page.getSize()
        const pointsPerCssPixel = pageSize.height / rect.height
        const padding = 3 * pointsPerCssPixel
        const fontSize = Math.max(1, box.fontSize * pointsPerCssPixel)
        const boxWidth = Math.max(
          1,
          box.width * pointsPerCssPixel - padding * 2,
        )
        const lineHeight = fontSize * 1.25
        const lines: string[] = []

        for (const paragraph of box.text.split('\n')) {
          const words = paragraph.split(/\s+/).filter(Boolean)

          if (words.length === 0) {
            lines.push('')
            continue
          }

          let line = ''

          for (const word of words) {
            const candidate = line ? `${line} ${word}` : word

            if (
              line &&
              font.widthOfTextAtSize(candidate, fontSize) > boxWidth
            ) {
              lines.push(line)
              line = word
            } else {
              line = candidate
            }
          }

          lines.push(line)
        }

        const x = (box.x / 100) * pageSize.width + padding
        let y =
          pageSize.height -
          (box.y / 100) * pageSize.height -
          fontSize

        for (const line of lines) {
          if (y < 0) break

          page.drawText(line, {
            x,
            y,
            size: fontSize,
            font,
          })

          y -= lineHeight
        }
      }

      const output = await pdfDoc.save()
      const blob = new Blob([output as BlobPart], {
        type: 'application/pdf',
      })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      const baseName = file.name.replace(/\.pdf$/i, '')

      link.href = url
      link.download = `${baseName}-edited.pdf`
      document.body.appendChild(link)
      link.click()
      link.remove()

      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (exportError) {
      console.error('PDF export failed:', exportError)
      setError('Could not export this PDF. Try another PDF file.')
    } finally {
      setIsExporting(false)
    }
  }

  const textBoxCountForPage = (pageNumber: number) =>
    textBoxes.filter((box) => box.pageNumber === pageNumber).length

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

        <div className="topbar-actions">
          {selectedFile && (
            <button
              className="button button-primary"
              onClick={exportPdf}
              disabled={isExporting || !pdfDocument}
            >
              <span aria-hidden="true">↓</span>
              {isExporting ? 'Exporting...' : 'Export PDF'}
            </button>
          )}

          <button
            className="button button-secondary"
            onClick={openFilePicker}
          >
            Open PDF
          </button>
        </div>

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
              <strong>{selectedFile ? 'PDF selected' : 'No document'}</strong>
              <p>
                {selectedFile
                  ? `${(selectedFile.size / 1024 / 1024).toFixed(2)} MB`
                  : 'Upload a PDF to begin'}
              </p>
              {selectedFile && (
                <p>{pageCount} pages · {textBoxes.length} text boxes</p>
              )}
            </div>
          </div>

          {selectedFile && pageCount > 0 && (
            <div className="page-jump">
              <label htmlFor="page-jump-input">GO TO PAGE</label>
              <div className="page-jump-row">
                <input
                  ref={pageNavigationInput}
                  id="page-jump-input"
                  type="number"
                  min={1}
                  max={pageCount}
                  value={pageToJump}
                  onChange={(event) => setPageToJump(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') jumpToPage()
                  }}
                />
                <span>of {pageCount}</span>
                <button
                  className="button button-secondary page-jump-button"
                  onClick={jumpToPage}
                >
                  Go
                </button>
              </div>
            </div>
          )}

          <div className="sidebar-tip">
            <span aria-hidden="true">✳</span>
            <strong>Quick tip</strong>
            <p>
              {activeTool === 'text'
                ? 'Click any page to place text. Press Alt + T to add a box to the page nearest the center of your screen.'
                : 'Scroll through the whole document, or use Go to Page to jump directly.'}
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

            {selectedFile && pageCount > 0 && (
              <div className="document-count">
                {pageCount} {pageCount === 1 ? 'page' : 'pages'} · continuous view
              </div>
            )}
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
                ) : pdfDocument ? (
                  Array.from(
                    { length: pageCount },
                    (_, index) => index + 1,
                  ).map((pageNumber) => (
                    <div
                      className="pdf-page-wrap"
                      key={`${selectedFile.name}-${pageNumber}`}
                    >
                      <div
                        ref={(element) =>
                          registerPageElement(pageNumber, element)
                        }
                        className={`pdf-page ${activeTool === 'text' ? 'text-placement-mode' : ''}`}
                        onClick={(event) =>
                          handlePageClick(pageNumber, event)
                        }
                        data-page-number={pageNumber}
                        data-rendered-width={pageDimensions[pageNumber]?.width}
                        data-rendered-height={pageDimensions[pageNumber]?.height}
                      >
                        <PdfPageCanvas
                          pdf={pdfDocument}
                          pageNumber={pageNumber}
                          onPageReady={handlePageReady}
                        />

                        <div className="text-box-layer">
                          {textBoxes
                            .filter((box) => box.pageNumber === pageNumber)
                            .map((box) => (
                              <div
                                key={box.id}
                                className={[
                                  'text-box',
                                  box.activated ? 'activated' : 'unactivated',
                                  selectedBoxId === box.id ? 'selected' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                style={{
                                  left: `${box.x}%`,
                                  top: `${box.y}%`,
                                  width: `${box.width}px`,
                                  height: `${box.height}px`,
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
                                    handleDragMove(event, box)
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
                                  onFocus={() => activateTextBox(box.id)}
                                  onClick={() => activateTextBox(box.id)}
                                  onChange={(event) =>
                                    updateTextBox(box.id, event.target.value)
                                  }
                                />

                                <div
                                  className="text-box-resize-handle"
                                  title="Resize text box"
                                  role="presentation"
                                  onPointerDown={(event) =>
                                    handleResizeStart(event, box)
                                  }
                                  onPointerMove={(event) =>
                                    handleResizeMove(event, box)
                                  }
                                  onPointerUp={() => setResizeStart(null)}
                                  onPointerCancel={() => setResizeStart(null)}
                                />
                              </div>
                            ))}
                        </div>
                      </div>

                      <div className="pdf-page-label">
                        Page {pageNumber} of {pageCount}
                        {textBoxCountForPage(pageNumber) > 0 &&
                          ` · ${textBoxCountForPage(pageNumber)} text ${textBoxCountForPage(pageNumber) === 1 ? 'box' : 'boxes'}`}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="loading-message">Loading PDF pages...</div>
                )}

                <button
                  className="button button-secondary choose-another-button"
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

                <p className="file-hint">or drag and drop a PDF here</p>

                {isDragging && (
                  <p className="drop-message">Drop your PDF to open it</p>
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
            <span>PDF Text Editor · Multi-page preview</span>
          </footer>
        </section>
      </div>
    </main>
  )
}

export default App