import { type ChangeEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';

interface SignaturePadProps {
  onChange: (signatureDataUrl: string | null) => void;
}

export function SignaturePad({ onChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasInkRef = useRef(false);
  const [mode, setMode] = useState<'draw' | 'type'>('draw');
  const [typedSignature, setTypedSignature] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.style.touchAction = 'none';
      canvas.width = Math.floor(rect.width * ratio);
      canvas.height = Math.floor(rect.height * ratio);
      const context = canvas.getContext('2d');

      if (!context) {
        return;
      }

      context.scale(ratio, ratio);
      context.lineWidth = 2.6;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.strokeStyle = '#101820';
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, rect.width, rect.height);
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  const startDrawing = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) {
      return;
    }

    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
    const point = getPoint(canvas, event);
    drawingRef.current = true;
    context.beginPath();
    context.moveTo(point.x, point.y);
  };

  const draw = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) {
      return;
    }

    event.preventDefault();
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    if (!canvas || !context) {
      return;
    }

    const point = getPoint(canvas, event);
    context.lineTo(point.x, point.y);
    context.stroke();
    hasInkRef.current = true;
  };

  const stopDrawing = (event?: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const wasDrawing = drawingRef.current;
    drawingRef.current = false;

    if (event && canvas?.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }

    if (!wasDrawing) {
      return;
    }

    if (canvas && hasInkRef.current) {
      onChange(canvas.toDataURL('image/png'));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');

    hasInkRef.current = false;
    setTypedSignature('');
    onChange(null);

    if (!canvas || !context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, rect.width, rect.height);
  };

  const changeMode = (nextMode: 'draw' | 'type') => {
    setMode(nextMode);
    clear();
  };

  const updateTypedSignature = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    setTypedSignature(value);

    if (!value.trim()) {
      onChange(null);
      return;
    }

    onChange(createTypedSignatureDataUrl(value.trim()));
  };

  return (
    <div className="signature-box">
      <div className="signature-mode" role="tablist" aria-label="Signature input mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'draw'}
          className={mode === 'draw' ? 'active' : ''}
          onClick={() => changeMode('draw')}
        >
          Draw
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'type'}
          className={mode === 'type' ? 'active' : ''}
          onClick={() => changeMode('type')}
        >
          Type
        </button>
      </div>

      {mode === 'draw' ? (
        <div className="signature-pad">
          <canvas
            ref={canvasRef}
            role="img"
            aria-label="Drawn signature input"
            onPointerDown={startDrawing}
            onPointerMove={draw}
            onPointerUp={stopDrawing}
            onPointerCancel={stopDrawing}
            onLostPointerCapture={stopDrawing}
          />
          <button className="icon-button clear-button" type="button" onClick={clear} title="Clear signature">
            <RotateCcw size={17} />
          </button>
        </div>
      ) : (
        <label className="typed-signature">
          <span>Typed signature</span>
          <input
            value={typedSignature}
            onChange={updateTypedSignature}
            placeholder="Type your signature"
            autoComplete="name"
          />
        </label>
      )}
    </div>
  );
}

function getPoint(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function createTypedSignatureDataUrl(value: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 720;
  canvas.height = 240;
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#101820';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(64, 176);
  context.lineTo(656, 176);
  context.stroke();
  context.fillStyle = '#101820';
  context.font = 'italic 58px Georgia, serif';
  context.textBaseline = 'middle';
  context.fillText(fitText(value, 28), 72, 126, 576);

  return canvas.toDataURL('image/png');
}

function fitText(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
