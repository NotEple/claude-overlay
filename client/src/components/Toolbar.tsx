import { useRef, useState } from 'react';
import { randomUUID } from '../utils';
import { TextDialog, encodeTextSrc } from './TextDialog';
import type { TextConfig } from './TextDialog';
import type { CanvasElement, MediaType } from '../types';

interface ToolbarProps {
  onAdd: (element: CanvasElement) => void;
}

const ACCEPTED = 'image/*,video/mp4,video/webm,audio/mpeg,audio/wav,audio/ogg,.gif';
const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

export function Toolbar({ onAdd }: ToolbarProps) {
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
      const res = await fetch(`${SERVER_URL}/upload`, { method: 'POST', body, credentials: 'include' });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { url, mimetype } = await res.json();

      const type: MediaType = mimetype.startsWith('audio') ? 'audio'
        : mimetype.startsWith('video') ? 'video'
        : mimetype === 'image/gif' ? 'gif'
        : 'image';

      // Default dimensions — ImageEl will correct width/height once image loads
      onAdd({
        id: randomUUID(), type,
        src: `${SERVER_URL}${url}`,   // absolute URL so overlay can load it too
        x: 200, y: 200,
        width: 400, height: 225,       // 16:9 placeholder, corrected on load
        rotation: 0, scaleX: 1, scaleY: 1,
        visible: true, zIndex: Date.now(),
      });
    } catch (err: any) {
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

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px',
        background: '#141414', borderBottom: '1px solid #222', flexShrink: 0,
      }}>
        <input ref={fileRef} type="file" accept={ACCEPTED} style={{ display: 'none' }} onChange={handleFile} />

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

        {error && (
          <span style={{ fontSize: 11, color: '#f87171', fontFamily: 'Inter, sans-serif' }}>{error}</span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 10, color: '#374151', fontFamily: 'Inter, sans-serif' }}>
          Right-click or Delete key to remove elements
        </span>
      </div>

      {showTextDialog && (
        <TextDialog onConfirm={handleTextConfirm} onClose={() => setShowTextDialog(false)} />
      )}
    </>
  );
}
