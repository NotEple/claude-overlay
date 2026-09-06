import { useEffect, useRef, useState } from "react";
import type { ChatEmoteSettings, ChatEmoteSpawn } from "../types";

interface Particle extends ChatEmoteSpawn {
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
  aspectRatio: number;
}

interface ChatEmoteLayerProps {
  spawn: ChatEmoteSpawn | null;
  settings: ChatEmoteSettings;
  preview?: boolean;
}

export function ChatEmoteLayer({ spawn, settings, preview = false }: ChatEmoteLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const nodesRef = useRef(new Map<string, HTMLDivElement>());
  const settingsRef = useRef(settings);
  const spawnQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    particlesRef.current = particles;
  }, [particles]);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!preview && !settings.enabled) setParticles([]);
  }, [preview, settings.enabled]);

  useEffect(() => {
    if (!spawn) return;
    const queuedSpawns: ChatEmoteSpawn[] = [
      { ...spawn, additional: undefined },
      ...(spawn.additional ?? []).map((item) => ({
        ...spawn,
        ...item,
        additional: undefined,
      })),
    ];
    // Resolve image dimensions serially so a slower CDN response cannot let a
    // later chat message jump ahead in parade mode.
    for (const queuedSpawn of queuedSpawns) {
      spawnQueueRef.current = spawnQueueRef.current.then(() => new Promise<void>((resolve) => {
      const activeSettings = settingsRef.current;
      if (!activeSettings.enabled && !preview) {
        resolve();
        return;
      }
      const image = new Image();
      image.onload = () => {
      const container = containerRef.current;
      const width = container?.clientWidth || 1920;
      const height = container?.clientHeight || 1080;
      const scale = preview ? 0.42 : 1;
      const size = activeSettings.size * scale;
      const aspectRatio = Math.max(
        0.5,
        Math.min(4, image.naturalWidth / Math.max(1, image.naturalHeight)),
      );
      const particleWidth = size * aspectRatio;
      const speed = activeSettings.speed * scale;
      const labelHeight = activeSettings.showNames
        ? (activeSettings.nameFontSize + 8) * scale
        : 0;
      let x: number;
      let y: number;
      let vx: number;
      let vy: number;
      if (activeSettings.motion === "parade") {
        const rightmost = particlesRef.current.reduce((edge, particle) => {
          const width = size * particle.aspectRatio;
          return Math.max(edge, particle.x + width);
        }, width);
        x = rightmost + (particlesRef.current.length ? 12 * scale : 0);
        y = height - size - labelHeight;
        vx = -speed;
        vy = 0;
      } else if (activeSettings.motion === "floor") {
        x = Math.random() * Math.max(1, width - particleWidth);
        y = height * (0.08 + Math.random() * 0.25);
        vx = (Math.random() < 0.5 ? -1 : 1) * speed * (0.45 + Math.random() * 0.55);
        vy = -speed * (0.25 + Math.random() * 0.55);
      } else {
        const edge = Math.floor(Math.random() * 4);
        const alongX = Math.random() * Math.max(1, width - particleWidth);
        const alongY = Math.random() * Math.max(1, height - size - labelHeight);
        const angleOffset = (Math.random() - 0.5) * 0.9;
        x = alongX;
        y = alongY;
        let angle = angleOffset;
        if (edge === 0) { x = 0; angle = angleOffset; }
        if (edge === 1) { x = width - particleWidth; angle = Math.PI + angleOffset; }
        if (edge === 2) { y = 0; angle = Math.PI / 2 + angleOffset; }
        if (edge === 3) { y = height - size - labelHeight; angle = -Math.PI / 2 + angleOffset; }
        vx = Math.cos(angle) * speed;
        vy = Math.sin(angle) * speed;
      }
      const particle: Particle = {
        ...queuedSpawn,
        x,
        y,
        vx,
        vy,
        bornAt: performance.now(),
        aspectRatio,
      };
      setParticles((current) => {
        const next = activeSettings.motion === "parade"
          ? (current.length >= activeSettings.maxVisible ? current : [...current, particle])
          : [...current, particle].slice(-activeSettings.maxVisible);
        particlesRef.current = next;
        return next;
      });
      resolve();
      };
      image.onerror = () => resolve();
      image.src = queuedSpawn.imageUrl;
      }));
    }
  }, [preview, spawn]);

  useEffect(() => {
    const blocked = new Set(settings.blacklist);
    setParticles((current) =>
      current.filter(
        (particle) => !particle.senderLogin || !blocked.has(particle.senderLogin),
      ),
    );
  }, [settings.blacklist]);

  useEffect(() => {
    let frame = 0;
    let previous = performance.now();
    const animate = (now: number) => {
      const container = containerRef.current;
      const width = container?.clientWidth || 1920;
      const height = container?.clientHeight || 1080;
      const scale = preview ? 0.42 : 1;
      const size = settings.size * scale;
      const labelHeight = settings.showNames
        ? (settings.nameFontSize + 8) * scale
        : 0;
      const dt = Math.min(0.05, Math.max(0, (now - previous) / 1000));
      previous = now;
      const expired: string[] = [];
      for (const particle of particlesRef.current) {
        const particleWidth = size * particle.aspectRatio;
        const floorY = height - size - labelHeight;
        if (settings.motion === "parade") {
          particle.vx = -settings.speed * scale;
          particle.vy = 0;
          particle.x += particle.vx * dt;
          particle.y = floorY;
          const node = nodesRef.current.get(particle.id);
          if (node) node.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0)`;
          if (particle.x + particleWidth < 0) expired.push(particle.id);
          continue;
        }
        const restingOnFloor =
          settings.motion === "floor" &&
          particle.y >= floorY - 0.5 &&
          particle.vy === 0;
        if (settings.motion === "floor" && !restingOnFloor)
          particle.vy += settings.gravity * scale * dt;
        if (restingOnFloor) particle.vx *= Math.pow(0.35, dt);
        particle.x += particle.vx * dt;
        particle.y += particle.vy * dt;
        if (particle.x <= 0 || particle.x + particleWidth >= width) {
          particle.x = Math.max(0, Math.min(width - particleWidth, particle.x));
          particle.vx *= settings.motion === "floor" ? -0.84 : -1;
        }
        if (particle.y <= 0) {
          particle.y = 0;
          particle.vy = Math.abs(particle.vy) * (settings.motion === "floor" ? 0.7 : 1);
        }
        if (particle.y + size + labelHeight >= height) {
          particle.y = floorY;
          particle.vy = settings.motion === "floor" && Math.abs(particle.vy) < 80 * scale
            ? 0
            : -Math.abs(particle.vy) * (settings.motion === "floor" ? 0.68 : 1);
          if (settings.motion === "floor") particle.vx *= 0.92;
        }
        const node = nodesRef.current.get(particle.id);
        if (node) node.style.transform = `translate3d(${particle.x}px, ${particle.y}px, 0)`;
        if (now - particle.bornAt >= settings.lifetimeSeconds * 1000)
          expired.push(particle.id);
      }
      if (expired.length) {
        const expiredIds = new Set(expired);
        setParticles((current) => current.filter((particle) => !expiredIds.has(particle.id)));
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [preview, settings.gravity, settings.lifetimeSeconds, settings.motion, settings.nameFontSize, settings.showNames, settings.size, settings.speed]);

  const scale = preview ? 0.42 : 1;
  return (
    <div ref={containerRef} className={`chat-emote-layer${preview ? " chat-emote-layer--preview" : ""}`}>
      {particles.map((particle) => (
        <div
          key={particle.id}
          ref={(node) => {
            if (node) nodesRef.current.set(particle.id, node);
            else nodesRef.current.delete(particle.id);
          }}
          className="chat-emote-particle"
          style={{ width: settings.size * scale * particle.aspectRatio }}
        >
          {settings.showNames && (
            <span
              style={{
                color: particle.senderColor || "#fff",
                background: settings.nameBackgroundEnabled
                  ? settings.nameBackgroundColor
                  : "transparent",
                fontSize: Math.max(7, settings.nameFontSize * scale),
              }}
            >
              {particle.sender}
            </span>
          )}
          <div
            className="chat-emote-stack"
            style={{
              width: settings.size * scale * particle.aspectRatio,
              height: settings.size * scale,
            }}
          >
            <img src={particle.imageUrl} alt={particle.name} draggable={false} />
            {particle.overlays?.map((overlay, index) => (
              <img
                key={`${overlay.emoteId}-${index}`}
                className="chat-emote-stack__overlay"
                src={overlay.imageUrl}
                alt={overlay.name}
                draggable={false}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
