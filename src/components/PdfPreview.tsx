import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, ZoomIn, ZoomOut } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';

type PdfDocument = Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>;

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfPreviewProps {
  fileDataUrl: string;
  fileName: string;
  title: string;
  onDownload: () => void;
}

export function PdfPreview({ fileDataUrl, fileName, title, onDownload }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PdfDocument | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    setPdf(null);
    setPageNumber(1);
    setPageCount(0);

    const loadingTask = pdfjs.getDocument({ data: dataUrlToBytes(fileDataUrl) });

    loadingTask.promise
      .then((loadedPdf) => {
        if (cancelled) {
          return;
        }

        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to render this PDF preview.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      void loadingTask.destroy();
    };
  }, [fileDataUrl]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null = null;

    async function renderPage() {
      setRendering(true);
      setError('');

      try {
        const page = await pdf!.getPage(pageNumber);
        if (cancelled || !canvasRef.current) {
          return;
        }

        const baseViewport = page.getViewport({ scale: 1 });
        const frameWidth = frameRef.current?.clientWidth || baseViewport.width;
        const fitScale = Math.max(0.4, Math.min(frameWidth / baseViewport.width, 1.8));
        const viewport = page.getViewport({ scale: fitScale * zoom });
        const pixelRatio = window.devicePixelRatio || 1;
        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('Canvas rendering is unavailable on this device.');
        }

        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, viewport.width, viewport.height);

        renderTask = page.render({ canvas, canvasContext: context, viewport });
        await renderTask.promise;
      } catch (renderError) {
        if (!cancelled && !isRenderCancelled(renderError)) {
          setError(renderError instanceof Error ? renderError.message : 'Unable to render this PDF page.');
        }
      } finally {
        if (!cancelled) {
          setRendering(false);
        }
      }
    }

    void renderPage();

    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [pdf, pageNumber, zoom]);

  const previousDisabled = pageNumber <= 1 || loading || rendering;
  const nextDisabled = !pageCount || pageNumber >= pageCount || loading || rendering;

  return (
    <div className="pdf-preview" aria-label={`PDF preview for ${title}`}>
      <div className="pdf-toolbar">
        <div className="pdf-page-controls">
          <button
            type="button"
            className="icon-button"
            onClick={() => setPageNumber((current) => Math.max(1, current - 1))}
            disabled={previousDisabled}
            title="Previous page"
            aria-label="Previous page"
          >
            <ChevronLeft size={17} />
          </button>
          <span>
            Page {pageCount ? pageNumber : '-'} of {pageCount || '-'}
          </span>
          <button
            type="button"
            className="icon-button"
            onClick={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
            disabled={nextDisabled}
            title="Next page"
            aria-label="Next page"
          >
            <ChevronRight size={17} />
          </button>
        </div>

        <div className="pdf-actions">
          <button
            type="button"
            className="icon-button"
            onClick={() => setZoom((current) => Math.max(0.75, Number((current - 0.15).toFixed(2))))}
            disabled={loading || zoom <= 0.75}
            title="Zoom out"
            aria-label="Zoom out"
          >
            <ZoomOut size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => setZoom((current) => Math.min(1.9, Number((current + 0.15).toFixed(2))))}
            disabled={loading || zoom >= 1.9}
            title="Zoom in"
            aria-label="Zoom in"
          >
            <ZoomIn size={16} />
          </button>
          <button type="button" className="icon-button" onClick={onDownload} title={`Download ${fileName}`} aria-label="Download PDF">
            <Download size={16} />
          </button>
        </div>
      </div>

      <div className="pdf-canvas-frame" ref={frameRef}>
        {(loading || rendering) && (
          <div className="pdf-state">
            <Loader2 className="spin" size={22} />
            <span>{loading ? 'Loading PDF' : 'Rendering page'}</span>
          </div>
        )}
        {error && (
          <div className="pdf-state error">
            <span>{error}</span>
            <button type="button" className="secondary-button" onClick={onDownload}>
              <Download size={16} />
              Download PDF
            </button>
          </div>
        )}
        <canvas className="pdf-canvas" ref={canvasRef} />
      </div>
    </div>
  );
}

function dataUrlToBytes(dataUrl: string) {
  const commaIndex = dataUrl.indexOf(',');
  const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isRenderCancelled(error: unknown) {
  return error instanceof Error && error.name === 'RenderingCancelledException';
}
