import { Headphones, Upload } from "lucide-react";
import { useRef } from "react";
import type { DvdCelebrationSettings } from "../types";
import { getFileLabel } from "../canvas/config";
import { useToast } from "./ToastProvider";

interface Props { settings: DvdCelebrationSettings; uploading: boolean; onChange: (settings: DvdCelebrationSettings) => void; onSoundUpload: (event: React.ChangeEvent<HTMLInputElement>) => void; }

export function DvdCelebrationControls({ settings, uploading, onChange, onSoundUpload }: Props) {
  const toast = useToast();
  const previewRef = useRef<HTMLAudioElement | null>(null);
  const preview = () => {
    previewRef.current?.pause();
    if (settings.soundUrl) {
      const audio = new Audio(settings.soundUrl); audio.volume = settings.volume; previewRef.current = audio;
      void audio.play().then(() => toast.info("Previewing DVD corner sound locally"), () => toast.error("DVD sound preview could not be played")); return;
    }
    const context = new AudioContext();
    [659.25, 783.99, 1046.5].forEach((frequency, index) => {
      const oscillator = context.createOscillator(); const gain = context.createGain(); const start = context.currentTime + index * 0.11;
      oscillator.type = "triangle"; oscillator.frequency.value = frequency; gain.gain.setValueAtTime(Math.max(0.001, settings.volume * 0.22), start); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
      oscillator.connect(gain).connect(context.destination); oscillator.start(start); oscillator.stop(start + 0.21);
    });
    toast.info("Previewing built-in DVD corner chime locally");
  };
  return <div className="dvd-inline-settings">
    <div className="dvd-inline-settings__sound"><span>Corner sound</span><strong title={settings.soundUrl ?? undefined}>{settings.soundUrl ? getFileLabel(settings.soundUrl) : "Built-in chime"}</strong><button className="ui-icon-button" onClick={preview} title="Preview corner sound on this dashboard"><Headphones size={13}/></button></div>
    <label><span>Volume</span><input type="range" min="0" max="1" step="0.05" value={settings.volume} onChange={(event) => onChange({ ...settings, volume: Number(event.target.value) })}/><output>{Math.round(settings.volume * 100)}%</output></label>
    <label><span>Counter</span><select value={settings.counterPosition} onChange={(event) => { onChange({ ...settings, counterPosition: event.target.value as DvdCelebrationSettings["counterPosition"] }); toast.success(`DVD counter moved to ${event.target.options[event.target.selectedIndex].text.toLowerCase()}`); }} title="Choose the corner counter position"><option value="top-left">Top left</option><option value="top-center">Top center</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-center">Bottom center</option><option value="bottom-right">Bottom right</option></select></label>
    <div className="dvd-inline-settings__actions"><label className="ui-button ui-button--compact" title="Upload a DVD corner sound"><Upload size={12}/>{uploading ? "Uploading…" : settings.soundUrl ? "Replace sound" : "Upload sound"}<input hidden type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/webm" disabled={uploading} onChange={onSoundUpload}/></label><button className="ui-button ui-button--compact" disabled={!settings.soundUrl} onClick={() => { onChange({ ...settings, soundUrl: null }); toast.success("Using the built-in DVD corner chime"); }} title="Restore the built-in corner chime">Built-in chime</button></div>
  </div>;
}
