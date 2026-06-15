import { useState, useCallback, useRef } from 'react';
import { CanvasStage, ElementPanel, SPAWN_X, SPAWN_Y, WORKSPACE_W, WORKSPACE_H } from '../components/CanvasStage';
import { DrawingCanvas, renderStroke } from '../components/DrawingCanvas';
import { Toolbar } from '../components/Toolbar';
import { WhitelistPanel } from '../components/WhitelistPanel';
import { TextDialog, encodeTextSrc, decodeTextSrc } from '../components/TextDialog';
import { useSocket } from '../hooks/useSocket';
import { randomUUID } from '../utils';
import type { AuthUser } from '../hooks/useAuth';
import type { CanvasElement, MediaControlPayload } from '../types';

interface DashboardProps {
  user: AuthUser;
  onLogout: () => void;
  onSessionRevoked: () => void;
  onRoleUpdated: () => void;
}

export function Dashboard({ user, onLogout, onSessionRevoked, onRoleUpdated }: DashboardProps) {
  const dashboardControlRef = useRef<((payload: MediaControlPayload) => void) | null>(null);
  const directUpdateRef = useRef<((id: string, changes: Partial<CanvasElement>) => void) | null>(null);

  const handleIncomingMediaControl = useCallback((payload: MediaControlPayload) => {
    dashboardControlRef.current?.(payload);
  }, []);

  const {
    elements, connected, cursors, activeUsers, strokes, liveStrokes,
    addElement, updateElement, removeElement, triggerAudio, sendCursor, emitMediaControl, refreshOverlay, addStroke, clearStrokes, sendLiveStroke,
  } = useSocket({ mode: 'dashboard', onSessionRevoked, onRoleUpdated, onMediaControl: handleIncomingMediaControl, directUpdateRef });

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showWhitelist, setShowWhitelist] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawColor, setDrawColor] = useState('#ff4444');
  const [drawSize, setDrawSize] = useState(6);
  const [drawEraser, setDrawEraser] = useState(false);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [showTwitchEmbed, setShowTwitchEmbed] = useState(true);
  const [twitchPaused, setTwitchPaused] = useState(false);
  const twitchPlayerRef = useRef<any>(null);

  const handleTwitchPlayPause = useCallback(() => {
    const player = twitchPlayerRef.current;
    if (!player) return;
    if (twitchPaused) { player.play(); setTwitchPaused(false); }
    else { player.pause(); setTwitchPaused(true); }
  }, [twitchPaused]);

  const handleSelect = useCallback((id: string | null, multi = false) => {
    if (!id) { setSelectedIds(new Set()); return; }

    const clickedEl = elements.find((e) => e.id === id);
    if (clickedEl?.groupId && !multi) {
      const groupMembers = elements.filter((e) => e.groupId === clickedEl.groupId).map((e) => e.id);
      setSelectedIds(new Set(groupMembers));
      return;
    }

    setSelectedIds((prev) => {
      if (multi) { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }
      return new Set([id]);
    });

    if (clickedEl?.type === 'audio') triggerAudio(clickedEl.id, clickedEl.src);
  }, [elements, triggerAudio]);

  const handleSelectMany = useCallback((ids: string[]) => setSelectedIds(new Set(ids)), []);

  const handleDelete = useCallback((id: string) => {
    removeElement(id);
    setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
  }, [removeElement]);

  const handleAdd = useCallback((el: CanvasElement) => {
    addElement({ ...el, x: SPAWN_X, y: SPAWN_Y });
  }, [addElement]);

  const handleGroup = useCallback(() => {
    const groupId = randomUUID();
    selectedIds.forEach((id) => updateElement(id, { groupId }));
  }, [selectedIds, updateElement]);

  const handleUngroup = useCallback(() => {
    // Send null — server and clients both treat null groupId as "clear group"
    selectedIds.forEach((id) => updateElement(id, { groupId: null }));
  }, [selectedIds, updateElement]);

  const handleEditText = useCallback((id: string) => {
    setEditingTextId(id);
  }, []);

  const handleTextUpdate = useCallback((config: { text: string; color: string; fontSize: number; fontFamily: string }) => {
    if (!editingTextId) return;
    updateElement(editingTextId, { src: encodeTextSrc(config) });
    setEditingTextId(null);
  }, [editingTextId, updateElement]);

  const handleMediaControl = useCallback((id: string, action: MediaControlPayload['action'], currentTime: number) => {
    emitMediaControl({ id, action, currentTime });
    // Persist playback position so refreshing users resume at the right spot
    const timeUpdate: Partial<import('../types').CanvasElement> = { mediaCurrentTime: currentTime };
    if (action === 'play') timeUpdate.mediaPaused = false;
    else if (action === 'pause') timeUpdate.mediaPaused = true;
    updateElement(id, timeUpdate);
  }, [emitMediaControl, updateElement]);

  const handleSaveDrawingAsElement = useCallback(() => {
    if (strokes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const stroke of strokes) {
      for (const [x, y] of stroke.points) {
        if (x < minX) minX = x; if (y < minY) minY = y;
        if (x > maxX) maxX = x; if (y > maxY) maxY = y;
      }
    }
    const maxPad = Math.max(...strokes.map(s => s.size / 2));
    minX -= maxPad; minY -= maxPad; maxX += maxPad; maxY += maxPad;
    const w = Math.ceil(maxX - minX);
    const h = Math.ceil(maxY - minY);
    if (w <= 0 || h <= 0) return;
    const offscreen = document.createElement('canvas');
    offscreen.width = w;
    offscreen.height = h;
    const ctx = offscreen.getContext('2d')!;
    for (const stroke of strokes) {
      renderStroke(ctx, stroke, minX, minY);
    }
    const dataUrl = offscreen.toDataURL('image/png');
    addElement({
      id: randomUUID(), type: 'image', src: dataUrl,
      x: minX, y: minY, width: w, height: h,
      rotation: 0, scaleX: 1, scaleY: 1,
      visible: true, zIndex: Date.now(),
    });
    clearStrokes();
  }, [strokes, addElement, clearStrokes]);

  const isAdmin = user.isOwner || user.isAdmin;

  const editingTextEl = editingTextId ? elements.find((e) => e.id === editingTextId) : null;
  const editingTextConfig = editingTextEl ? decodeTextSrc(editingTextEl.src) : undefined;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d0d0d', color: 'white', overflow: 'hidden' }}>
      {/* Top bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', height: 36, background: '#111', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#818cf8', letterSpacing: '0.05em' }}>OBS Overlay</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {activeUsers.map((u) => (
              <img key={u.userId} src={u.avatar} alt={u.displayName} title={u.displayName}
                style={{ width: 22, height: 22, borderRadius: '50%', border: `2px solid ${u.color}` }} />
            ))}
          </div>
          <span style={{ fontSize: 11, color: connected ? '#4ade80' : '#f87171' }}>{connected ? '● Live' : '○ Disconnected'}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <img src={user.avatar} alt="" style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${user.color ?? '#9146FF'}` }} />
            <span style={{ fontSize: 11, color: '#ccc' }}>{user.displayName}</span>
            {user.isOwner && <span style={{ fontSize: 9, fontWeight: 600, color: '#a78bfa', background: '#1e1b4b', border: '1px solid #4c1d95', borderRadius: 3, padding: '1px 4px' }}>owner</span>}
            {!user.isOwner && user.isAdmin && <span style={{ fontSize: 9, fontWeight: 600, color: '#34d399', background: '#064e3b', border: '1px solid #065f46', borderRadius: 3, padding: '1px 4px' }}>admin</span>}
          </div>
          <button
            onClick={() => setShowTwitchEmbed((v) => !v)}
            style={{ background: showTwitchEmbed ? '#1e1b4b' : 'none', border: showTwitchEmbed ? '1px solid #4c1d95' : 'none', color: showTwitchEmbed ? '#a78bfa' : '#888', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
          >
            {showTwitchEmbed ? 'Hide Stream' : 'Show Stream'}
          </button>
          {showTwitchEmbed && (
            <button
              onClick={handleTwitchPlayPause}
              style={{ background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }}
            >
              {twitchPaused ? '▶' : '⏸'}
            </button>
          )}
          {isAdmin && (
            <>
              <button onClick={refreshOverlay} style={{ background: 'none', border: '1px solid #333', color: '#888', cursor: 'pointer', fontSize: 11, padding: '2px 8px', borderRadius: 4 }} title="Refresh OBS overlay">↺ Overlay</button>
              <button onClick={() => setShowWhitelist(true)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16, padding: 0 }}>⚙</button>
            </>
          )}
          <button onClick={onLogout} style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: 11 }}>Logout</button>
        </div>
      </div>

      <Toolbar
        onAdd={handleAdd}
        drawMode={drawMode}
        onDrawModeToggle={() => setDrawMode((v) => !v)}
        drawColor={drawColor}
        onDrawColorChange={setDrawColor}
        drawSize={drawSize}
        onDrawSizeChange={setDrawSize}
        drawEraser={drawEraser}
        onDrawEraserToggle={() => setDrawEraser((v) => !v)}
        onDrawClear={clearStrokes}
        onSaveDrawingAsElement={handleSaveDrawingAsElement}
        hasStrokes={strokes.length > 0}
      />

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <ElementPanel
          elements={elements}
          selectedIds={selectedIds}
          onSelect={handleSelect}
          onToggleVisible={(id) => { const el = elements.find((e) => e.id === id); if (el) updateElement(id, { visible: !el.visible }); }}
          onDelete={handleDelete}
          onGroup={handleGroup}
          onUngroup={handleUngroup}
          onElementChange={updateElement}
        />
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          <CanvasStage
            elements={elements}
            cursors={cursors}
            selectedIds={selectedIds}
            onSelect={handleSelect}
            onSelectMany={handleSelectMany}
            onElementChange={updateElement}
            onElementDelete={handleDelete}
            onCursorMove={sendCursor}
            onEditText={handleEditText}
            onMediaControl={handleMediaControl}
            mediaControlRef={dashboardControlRef}
            directUpdateRef={directUpdateRef}
            showTwitchEmbed={showTwitchEmbed}
            twitchChannel={user.login}
            twitchPlayerRef={twitchPlayerRef}
            drawingLayer={
              <DrawingCanvas
                width={WORKSPACE_W}
                height={WORKSPACE_H}
                strokes={strokes}
                liveStrokes={liveStrokes}
                drawMode={drawMode}
                color={drawColor}
                size={drawSize}
                eraser={drawEraser}
                onStroke={addStroke}
                onLiveStroke={sendLiveStroke}
              />
            }
          />
        </div>
      </div>

      {showWhitelist && <WhitelistPanel onClose={() => setShowWhitelist(false)} isOwner={user.isOwner} isAdmin={isAdmin} />}

      {editingTextId && (
        <TextDialog
          initial={editingTextConfig}
          onConfirm={handleTextUpdate}
          onClose={() => setEditingTextId(null)}
        />
      )}
    </div>
  );
}
