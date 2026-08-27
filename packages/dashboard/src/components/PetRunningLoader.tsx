import { useEffect, useRef, useState, type CSSProperties } from 'react';
import clickIdle from '@/assets/share-pets/click-idle.png';
import hawkingIdle from '@/assets/share-pets/hawking-idle.png';
import yoyoIdle from '@/assets/share-pets/yoyo-idle.png';
import './PetRunningLoader.css';

const LOADING_PETS = [
  {
    id: 'hawking',
    image: hawkingIdle,
    glow: { primary: '#ff7a1a', accent: '#ffd21f' },
  },
  {
    id: 'yoyo',
    image: yoyoIdle,
    glow: { primary: '#2f7df6', accent: '#ffd84a' },
  },
  {
    id: 'click',
    image: clickIdle,
    glow: { primary: '#51d6a2', accent: '#ff7b8d' },
  },
] as const;

type LoadingPetId = (typeof LOADING_PETS)[number]['id'];

const RUN_RANGE_PX = 72;
const RUN_SPEED_PX = 110;
const PET_SWAP_MS = 2_400;
const SPRITE_WIDTH = 80;
const SPRITE_HEIGHT = 88;

function pickRandomPetId(exclude?: LoadingPetId): LoadingPetId {
  const pool = LOADING_PETS.filter((pet) => pet.id !== exclude);
  const choices = pool.length > 0 ? pool : LOADING_PETS;
  return choices[Math.floor(Math.random() * choices.length)]!.id;
}

/**
 * Web/CLI fallback: pace share idle art across a runway and randomly cycle pets.
 * Desktop uses the real spritesheet runner instead.
 */
export function PetRunningLoader() {
  const [petId, setPetId] = useState<LoadingPetId>(() => pickRandomPetId());
  const spriteRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setPetId((current) => pickRandomPetId(current));
    }, PET_SWAP_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const el = spriteRef.current;
    if (!el) return;

    let raf = 0;
    let previous: number | null = null;
    let x = -RUN_RANGE_PX;
    let dir = 1;

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (previous == null) {
        previous = now;
        return;
      }
      const dt = Math.min(0.05, (now - previous) / 1000);
      previous = now;

      x += dir * RUN_SPEED_PX * dt;
      if (x >= RUN_RANGE_PX) {
        x = RUN_RANGE_PX;
        dir = -1;
      } else if (x <= -RUN_RANGE_PX) {
        x = -RUN_RANGE_PX;
        dir = 1;
      }

      el.style.transform = `translateX(${x}px) scaleX(${dir > 0 ? 1 : -1})`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [petId]);

  const pet = LOADING_PETS.find((item) => item.id === petId) ?? LOADING_PETS[0];
  const trackWidth = SPRITE_WIDTH + RUN_RANGE_PX * 2;

  return (
    <div
      aria-hidden="true"
      className="pet-running-loader"
      style={
        {
          width: trackWidth,
          height: SPRITE_HEIGHT,
          '--pet-glow-primary': pet.glow.primary,
          '--pet-glow-accent': pet.glow.accent,
        } as CSSProperties
      }
    >
      <img
        alt=""
        className="pet-running-loader__sprite"
        height={SPRITE_HEIGHT}
        ref={spriteRef}
        src={pet.image}
        width={SPRITE_WIDTH}
      />
    </div>
  );
}
