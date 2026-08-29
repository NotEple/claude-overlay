import { useEffect, useState } from 'react';
import { Star, X } from 'lucide-react';
import { authHeaders } from '../hooks/useAuth';
import { useToast } from './ToastProvider';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

interface WhitelistEntry {
  username: string;
  added_by: string;
  added_at: string;
  isAdmin: boolean;
}

interface WhitelistPanelProps {
  onClose: () => void;
  isOwner: boolean;
  isAdmin: boolean;
}

export function WhitelistPanel({ onClose, isOwner, isAdmin }: WhitelistPanelProps) {
  const [list, setList] = useState<WhitelistEntry[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const fetchList = async () => {
    try {
      const res = await fetch(`${SERVER_URL}/whitelist`, { credentials: 'include', headers: authHeaders() });
      if (res.ok) setList(await res.json());
      else toast.error('Could not load the whitelist');
    } catch { toast.error('Could not reach the server to load the whitelist'); }
  };

  useEffect(() => { fetchList(); }, []);

  const handleAdd = async () => {
    const username = input.trim().toLowerCase();
    if (!username) return;
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/whitelist`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();
      if (!res.ok) { toast.error(data.error || 'Could not add that user'); }
      else { toast.success(`Added ${data.displayName} to the whitelist`); setInput(''); fetchList(); }
    } catch { toast.error('Could not reach the server to add that user'); }
    finally { setLoading(false); }
  };

  const handleRemove = async (username: string) => {
    try {
      const response = await fetch(`${SERVER_URL}/whitelist/${username}`, { method: 'DELETE', credentials: 'include', headers: authHeaders() });
      if (!response.ok) { toast.error(`Could not remove ${username}`); return; }
      toast.success(`Removed ${username} from the whitelist`);
      fetchList();
    } catch { toast.error(`Could not reach the server to remove ${username}`); }
  };

  const handleToggleAdmin = async (username: string, isAdmin: boolean) => {
    try {
      const response = await fetch(`${SERVER_URL}/whitelist/${username}/admin`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ isAdmin: !isAdmin }),
      });
      if (!response.ok) { toast.error(`Could not update ${username}'s admin access`); return; }
      toast.success(`${username} is ${isAdmin ? 'no longer an admin' : 'now an admin'}`);
      fetchList();
    } catch { toast.error(`Could not reach the server to update ${username}`); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 50, display: 'flex', alignItems: 'start', justifyContent: 'flex-end' }} onClick={onClose}>
      <div style={{ height: '100%', width: 300, background: '#1a1a1a', borderLeft: '1px solid #333', display: 'flex', flexDirection: 'column', boxShadow: '0 0 20px rgba(0,0,0,0.5)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #333' }}>
          <h2 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#e2e8f0', fontFamily: 'Inter, sans-serif' }}>Whitelist</h2>
          <button className="ui-icon-button" title="Close whitelist settings" aria-label="Close whitelist settings" onClick={onClose} style={{ background: 'none', border: '1px solid #333', color: '#ccc', cursor: 'pointer', display: 'flex', alignItems: 'center' }}><X size={18} /></button>
        </div>

        {isAdmin && (
          <div style={{ padding: 16, borderBottom: '1px solid #333' }}>
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 500, color: '#a3aab5', fontFamily: 'Inter, sans-serif' }}>Add a Twitch username</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                placeholder="username" style={{ flex: 1, background: '#111', border: '1px solid #333', borderRadius: 4, color: '#e2e8f0', fontSize: 12, padding: '6px 10px', outline: 'none', fontFamily: 'Inter, sans-serif' }} />
              <button className="ui-button" title="Add this Twitch user to the dashboard whitelist" onClick={handleAdd} disabled={loading || !input.trim()}
                style={{ padding: '6px 12px', background: 'var(--accent-solid)', border: 'none', borderRadius: 4, color: 'var(--accent-contrast)', fontSize: 12, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1 }}>
                {loading ? '…' : 'Add'}
              </button>
            </div>
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {list.length === 0
            ? <p style={{ padding: 16, fontSize: 12, color: '#7c8593', textAlign: 'center', fontFamily: 'Inter, sans-serif' }}>No users whitelisted yet</p>
            : list.map((entry) => (
              <div key={entry.username} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid #222' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: '#ccc', fontFamily: 'Inter, sans-serif' }}>{entry.username}</span>
                    {entry.isAdmin && <span style={{ fontSize: 9, fontWeight: 600, color: '#34d399', background: '#064e3b', border: '1px solid #065f46', borderRadius: 3, padding: '1px 4px' }}>admin</span>}
                  </div>
                  <span style={{ fontSize: 11, color: '#8b95a5', fontFamily: 'Inter, sans-serif' }}>Added {new Date(entry.added_at).toLocaleDateString()}</span>
                </div>
                {isAdmin && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isOwner && (
                      <button className="ui-button ui-button--compact" onClick={() => handleToggleAdmin(entry.username, entry.isAdmin)}
                        title={entry.isAdmin ? 'Remove admin' : 'Make admin'}
                        style={{ fontSize: 10, padding: '2px 6px', background: entry.isAdmin ? '#064e3b' : '#1e293b', border: `1px solid ${entry.isAdmin ? '#065f46' : '#334155'}`, borderRadius: 3, color: entry.isAdmin ? '#34d399' : '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Star size={11} fill={entry.isAdmin ? 'currentColor' : 'none'} /> Admin
                      </button>
                    )}
                    <button className="ui-button ui-button--compact ui-danger" title={`Remove ${entry.username} from the whitelist and revoke dashboard access`} onClick={() => handleRemove(entry.username)}
                      style={{ fontSize: 10, padding: '2px 6px', background: 'none', border: 'none', color: '#f87171', cursor: 'pointer' }}>
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))
          }
        </div>
      </div>
    </div>
  );
}
