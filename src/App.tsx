
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker

type Tool = 'select' | 'text'

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [activeTool, setActiveTool] = useState<Tool>('select')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [renderError, setRenderError] = useState('')
  const [pageCount, setPageCount] = useState(0)

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

        const bytes = new Uint8Array(
          await file.arrayBuffer(),
        )

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
            <span className="tool-shortcut">Ctrl T</span>
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
            </div>
          </div>

          <div className="sidebar-tip">
            <span aria-hidden="true">✳</span>
            <strong>Quick tip</strong>
            <p>
              {activeTool === 'text'
                ? 'Once a PDF is open, use Ctrl + T to quickly create text boxes.'
                : 'Choose Add text to prepare for placing text on your document.'}
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
                    <div className="pdf-page">
                      <canvas
                        ref={canvasRef}
                        className="pdf-canvas"
                        aria-label="First page of the selected PDF"
                      />
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
