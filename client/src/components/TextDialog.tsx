import { useState } from 'react';

export interface TextConfig {
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
}

const FONTS = ['Inter', 'Arial', 'Georgia', 'Impact', 'Courier New', 'Verdana', 'Trebuchet MS', 'Times New Roman', 'Comic Sans MS'];

interface TextDialogProps {
  initial?: TextConfig;
  onConfirm: (config: TextConfig) => void;
  onClose: () => void;
}

export function TextDialog({ initial, onConfirm, onClose }: TextDialogProps) {
  const [text, setText] = useState(initial?.text ?? '');
  const [color, setColor] = useState(initial?.color ?? '#ffffff');
  const [fontSize, setFontSize] = useState(initial?.fontSize ?? 48);
  const [fontFamily, setFontFamily] = useState(initial?.fontFamily ?? 'Inter');

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 500 }} onClick={onClose}>
      <div style={{ background: '#1a1a1a', border: '1px solid #333', borderRadius: 10, padding: 24, width: 460, maxWidth: '95vw', display: 'flex', flexDirection: 'column', gap: 14, boxSizing: 'border-box' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>
          {initial ? 'Edit text' : 'Add text'}
        </h3>

        {/* Preview */}
        <div style={{ background: '#111', borderRadius: 6, padding: 20, minHeight: 70, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #222', overflow: 'hidden' }}>
          <span style={{ fontFamily: fontFamily + ', sans-serif', fontSize: Math.min(fontSize, 52), color, textShadow: '1px 1px 4px rgba(0,0,0,0.8)', wordBreak: 'break-word', textAlign: 'center' }}>
            {text || 'Preview text'}
          </span>
        </div>

        {/* Text input */}
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Enter your text…" rows={3}
          style={{ background: '#111', border: '1px solid #333', borderRadius: 6, color: '#e2e8f0', fontSize: 13, padding: '8px 12px', resize: 'vertical', fontFamily: 'Inter, sans-serif', outline: 'none', boxSizing: 'border-box', width: '100%' }}
          autoFocus />

        {/* Controls row */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          {/* Color */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontFamily: 'Inter, sans-serif' }}>Color</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
                style={{ width: 28, height: 28, border: 'none', background: 'none', cursor: 'pointer', padding: 0, flexShrink: 0 }} />
              <input value={color} onChange={(e) => setColor(e.target.value)}
                style={{ flex: 1, minWidth: 0, background: '#111', border: '1px solid #333', borderRadius: 4, color: '#e2e8f0', fontSize: 11, padding: '4px 6px', outline: 'none', fontFamily: 'monospace' }} />
            </div>
          </label>

          {/* Font size */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontFamily: 'Inter, sans-serif' }}>Size: {fontSize}px</span>
            <input type="range" min={8} max={400} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))}
              style={{ width: '100%', marginTop: 6 }} />
          </label>

          {/* Font family */}
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#888', fontFamily: 'Inter, sans-serif' }}>Font</span>
            <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}
              style={{ background: '#111', border: '1px solid #333', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '4px 6px', outline: 'none', width: '100%', boxSizing: 'border-box' }}>
              {FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button onClick={onClose} style={{ padding: '7px 16px', background: '#222', border: '1px solid #333', borderRadius: 6, color: '#aaa', fontSize: 13, cursor: 'pointer', fontFamily: 'Inter, sans-serif' }}>Cancel</button>
          <button onClick={() => { if (text.trim()) onConfirm({ text, color, fontSize, fontFamily }); }}
            disabled={!text.trim()}
            style={{ padding: '7px 16px', background: text.trim() ? '#4f46e5' : '#333', border: 'none', borderRadius: 6, color: 'white', fontSize: 13, cursor: text.trim() ? 'pointer' : 'not-allowed', fontFamily: 'Inter, sans-serif' }}>
            {initial ? 'Update' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  );
}

export function encodeTextSrc(config: TextConfig): string {
  return [config.text, config.color, config.fontSize, config.fontFamily].join('|||');
}

export function decodeTextSrc(src: string): TextConfig {
  const [text = '', color = '#ffffff', fs = '48', fontFamily = 'Inter'] = src.split('|||');
  return { text, color, fontSize: parseInt(fs, 10), fontFamily };
}
