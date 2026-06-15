import { useRef, useState } from 'react';
import { randomUUID } from '../utils';
import { TextDialog, encodeTextSrc } from './TextDialog';
import type { TextConfig } from './TextDialog';
import type { CanvasElement, MediaType } from '../types';
import { authHeaders } from '../hooks/useAuth';
import type { DrawToolMode } from './DrawingCanvas';

const PRESET_COLORS = ['#ffffff', '#ff4444', '#ff9900', '#ffff00', '#44ff44', '#44aaff', '#aa44ff', '#ff44aa', '#000000'];

interface ToolbarProps {
  onAdd: (element: CanvasElement) => void;
  drawMode: boolean;
  onDrawModeToggle: () => void;
  drawColor: string;
  onDrawColorChange: (c: string) => void;
  drawSize: number;
  onDrawSizeChange: (s: number) => void;
  toolMode: DrawToolMode;
  onToolModeChange: (m: DrawToolMode) => void;
  onDrawClear: () => void;
  onSaveDrawingAsElement: () => void;
  hasStrokes: boolean;
}

const ACCEPTED = 'image/*,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,.gif';
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export function Toolbar({
  onAdd,
  drawMode,
  onDrawModeToggle,
  drawColor,
  onDrawColorChange,
  drawSize,
  onDrawSizeChange,
  toolMode,
  onToolModeChange,
  onDrawClear,
  onSaveDrawingAsElement,
  hasStrokes,
}: ToolbarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [showTextDialog, setShowTextDialog] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    const body = new FormData();
    body.append('file', file);
    try {
      const res = await fetch(`${SERVER_URL}/upload`, { method: 'POST', body, credentials: 'include', headers: authHeaders() });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { url, mimetype } = await res.json();
      const type: MediaType = mimetype.startsWith('audio') ? 'audio'
        : mimetype.startsWith('video') ? 'video'
        : mimetype === 'image/gif' ? 'gif'
        : 'image';
      onAdd({
        id: randomUUID(), type,
        src: `${SERVER_URL}${url}`,
        x: 200, y: 200,
        width: 400, height: 225,
        rotation: 0, scaleX: 1, scaleY: 1,
        visible: true, zIndex: Date.now(),
      });
    } catch {
      setError('Upload failed — is the server running?');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  const handleTextConfirm = (config: TextConfig) => {
    onAdd({
      id: randomUUID(), type: 'text',
      src: encodeTextSrc(config),
      x: 200, y: 200,
      width: 400, height: 80,
      rotation: 0, scaleX: 1, scaleY: 1,
      visible: true, zIndex: Date.now(),
    });
    setShowTextDialog(false);
  };

  const toolBtn = (label: string, mode: DrawToolMode, title: string) => (
    <button
      onClick={() => onToolModeChange(mode)}
      title={title}
      style={{
        padding: '5px 12px',
        background: toolMode === mode ? '#4f46e5' : '#1e293b',
        border: `1px solid ${toolMode === mode ? '#6366f1' : '#334155'}`,
        borderRadius: 5, color: 'white', fontSize: 12,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif',
      }}
    >
      {label}
    </button>
  );

  const btn = (label: string, onClick: () => void, active = false, title?: string) => (
    <button
      onClick={onClick}
      title={title}
      style={{
        padding: '5px 12px',
        background: active ? '#4f46e5' : '#1e293b',
        border: `1px solid ${active ? '#6366f1' : '#334155'}`,
        borderRadius: 5, color: 'white', fontSize: 12,
        cursor: 'pointer', fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap',
      }}
    >
      {label}
    </button>
  );

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        background: '#141414', borderBottom: '1px solid #222', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <input ref={fileRef} type="file" accept={ACCEPTED} style={{ display: 'none' }} onChange={handleFile} />

        {!drawMode && (
          <>
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              style={{
                padding: '5px 14px', background: '#4f46e5', border: 'none', borderRadius: 5,
                color: 'white', fontSize: 12, cursor: uploading ? 'not-allowed' : 'pointer',
                opacity: uploading ? 0.6 : 1, fontFamily: 'Inter, sans-serif',
              }}
            >
              {uploading ? 'Uploading…' : '+ Media'}
            </button>
            <button
              onClick={() => setShowTextDialog(true)}
              style={{
                padding: '5px 14px', background: '#1e293b', border: '1px solid #334155',
                borderRadius: 5, color: 'white', fontSize: 12, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              + Text
            </button>
            <div style={{ width: 1, height: 20, background: '#2a2a2a', margin: '0 2px' }} />
          </>
        )}

        {btn(drawMode ? '✕ Exit Draw' : '✏️ Draw', onDrawModeToggle, drawMode, 'Toggle drawing mode')}

        {drawMode && (
          <>
            {/* Tool buttons */}
            {toolBtn('✏️ Pen', 'pen', 'Freehand pen')}
            {toolBtn('⬜ Erase', 'eraser', 'Eraser')}
            {toolBtn('🪣 Fill', 'fill', 'Flood fill enclosed area')}

            <div style={{ width: 1, height: 20, background: '#2a2a2a', margin: '0 2px' }} />

            {/* Color swatches */}
            <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => { onDrawColorChange(c); if (toolMode === 'eraser' || toolMode === 'fill') onToolModeChange('pen'); }}
                  title={c}
                  style={{
                    width: 18, height: 18,
                    background: c,
                    border: drawColor === c && toolMode === 'pen' ? '2px solid #fff' : '1.5px solid #555',
                    borderRadius: 3, cursor: 'pointer', padding: 0, flexShrink: 0,
                  }}
                />
              ))}
              <input
                type="color"
                value={drawColor}
                onChange={(e) => { onDrawColorChange(e.target.value); if (toolMode !== 'pen') onToolModeChange('pen'); }}
                title="Custom color"
                style={{ width: 22, height: 22, padding: 0, border: '1.5px solid #555', borderRadius: 3, cursor: 'pointer', background: 'none' }}
              />
            </div>

            {/* Size slider — not shown for fill */}
            {toolMode !== 'fill' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ fontSize: 11, color: '#666', fontFamily: 'Inter,sans-serif', whiteSpace: 'nowrap' }}>Size</span>
                <input
                  type="range" min="2" max="60" value={drawSize}
                  onChange={(e) => onDrawSizeChange(Number(e.target.value))}
                  style={{ width: 80, accentColor: '#6366f1' }}
                />
                <span style={{ fontSize: 11, color: '#555', fontFamily: 'Inter,sans-serif', minWidth: 20 }}>{drawSize}</span>
              </div>
            )}

            {hasStrokes && btn('📌 Add as Element', onSaveDrawingAsElement, false, 'Convert drawing to a draggable element')}
            {hasStrokes && btn('🗑 Clear', onDrawClear, false, 'Clear all drawing')}
          </>
        )}

        {error && (
          <span style={{ fontSize: 11, color: '#f87171', fontFamily: 'Inter, sans-serif' }}>{error}</span>
        )}
        {!drawMode && (
          <span style={{ marginLeft: 'auto', fontSize: 10, color: '#374151', fontFamily: 'Inter, sans-serif' }}>
            Right-click or Delete key to remove elements
          </span>
        )}
      </div>

      {showTextDialog && (
        <TextDialog onConfirm={handleTextConfirm} onClose={() => setShowTextDialog(false)} />
      )}
    </>
  );
}
