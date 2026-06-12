import { useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '../types';
import { Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? 'http://localhost:3001';

// Separate socket just for audio, used in the dashboard
export function useAudio(socket: Socket<ServerToClientEvents, ClientToServerEvents> | null) {
  const audioMap = useRef<Map<string, HTMLAudioElement>>(new Map());

  const play = (id: string, src: string) => {
    let audio = audioMap.current.get(id);
    if (!audio) {
      audio = new Audio(src);
      audioMap.current.set(id, audio);
    }
    audio.currentTime = 0;
    audio.play();
  };

  useEffect(() => {
    if (!socket) return;
    socket.on('audio:play', ({ id, src }) => play(id, src));
    return () => { socket.off('audio:play'); };
  }, [socket]);

  return { play };
}
