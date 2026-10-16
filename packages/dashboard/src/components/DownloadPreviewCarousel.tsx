import { useEffect, useRef, useState, type ReactNode } from 'react';
import clickIdle from '@/assets/share-pets/click-idle.png';
import hawkingIdle from '@/assets/share-pets/hawking-idle.png';
import yoyoIdle from '@/assets/share-pets/yoyo-idle.png';
import { cn, formatCompactTokenCount } from '@/lib/utils';

const PREVIEW_INTERVAL_MS = 5200;
const PET_BUBBLE_MS = 1600;

type PreviewSlide = {
  id: string;
  label: string;
  src: string;
  alt: string;
};

const PREVIEW_SRC = `${import.meta.env.BASE_URL}e1.png`;

const PREVIEW_SLIDES: readonly PreviewSlide[] = [
  {
    id: 'overview',
    label: '用量看板',
    src: PREVIEW_SRC,
    alt: 'Juejin Usage 用量看板界面预览：费用、Token、热力图与趋势图',
  },
  {
    id: 'share',
    label: '分享卡片',
    src: PREVIEW_SRC,
    alt: '分享卡片预览',
  },
];

const DEMO_PETS = [
  {
    id: 'hawking',
    name: 'Hawking',
    image: hawkingIdle,
    glow: '#ff7a1a',
    accent: '#ffd21f',
    tokens: '128.4万',
    cost: '$18.60',
  },
  {
    id: 'yoyo',
    name: 'Yoyo',
    image: yoyoIdle,
    glow: '#2f7df6',
    accent: '#ffd84a',
    tokens: '86.2万',
    cost: '$9.40',
  },
  {
    id: 'click',
    name: 'Click',
    image: clickIdle,
    glow: '#51d6a2',
    accent: '#ff7b8d',
    tokens: '42.8万',
    cost: '$4.15',
  },
] as const;

type DemoPetId = (typeof DEMO_PETS)[number]['id'];

type PetBubbleState =
  | { kind: 'usage'; id: DemoPetId }
  | { kind: 'sync'; id: DemoPetId; added: string };

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A plausible sync delta, then the same K/M/B compact format as the desktop pet. */
function randomAddedTokens(): string {
  const roll = Math.random();
  const tokens = roll < 0.3
    ? 80 + Math.random() * 900
    : roll < 0.75
      ? 1_000 + Math.random() * 180_000
      : 200_000 + Math.random() * 4_000_000;
  return formatCompactTokenCount(tokens);
}

function PetBubbleFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'absolute bottom-[calc(100%+0.75rem)] left-1/2 z-20 -translate-x-1/2 rounded-xl bg-white px-3 py-2 text-[#171717] shadow-[0_10px_28px_rgb(0_0_0/0.18)]',
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute -bottom-[5px] left-1/2 size-2.5 -translate-x-1/2 rotate-45 bg-white shadow-[2px_2px_3px_rgb(0_0_0/0.06)]"
      />
    </div>
  );
}

function PetSyncBubble({ added }: { added: string }) {
  return (
    <PetBubbleFrame className="w-max">
      <p className="flex items-center gap-1.5 text-[13px] leading-[1.2] font-semibold whitespace-nowrap text-[#171717]">
        <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[#0485f7]" />
        <span className="inline-flex items-baseline gap-0.5">
          <span className="tabular-nums">+</span>
          <span className="text-[#0485f7] tabular-nums">{added}</span>
        </span>
        <span className="ms-1 text-[11px] font-medium text-[#737373]">Token</span>
      </p>
    </PetBubbleFrame>
  );
}

function PetBubble({ tokens, cost }: { tokens: string; cost: string }) {
  return (
    <PetBubbleFrame className="w-[136px]">
      <p className="mb-1.5 text-center text-[10px] leading-[1.2] tracking-[0.02em] text-[#737373]">
        近 7 天
      </p>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-[1.2] text-[#737373]">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[#0485f7]" />
          Token
        </span>
        <span className="truncate text-[13px] leading-[1.2] font-semibold tabular-nums">{tokens}</span>
      </div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-[1.2] text-[#737373]">
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-[#4fbd91]" />
          费用
        </span>
        <span className="truncate text-[13px] leading-[1.2] font-semibold tabular-nums">{cost}</span>
      </div>
    </PetBubbleFrame>
  );
}

function DownloadPetStage() {
  const [bubble, setBubble] = useState<PetBubbleState | null>(null);
  const [hopId, setHopId] = useState<DemoPetId | null>(null);
  const hideTimer = useRef<number | null>(null);
  const bubbleRef = useRef(bubble);
  bubbleRef.current = bubble;

  const clearBubbleTimer = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };

  const showBubble = (id: DemoPetId) => {
    setHopId(id);
    if (bubble?.kind === 'usage' && bubble.id === id) {
      clearBubbleTimer();
      setBubble(null);
      return;
    }
    setBubble({ kind: 'usage', id });
    clearBubbleTimer();
    hideTimer.current = window.setTimeout(() => {
      hideTimer.current = null;
      setBubble((current) => (current?.kind === 'usage' && current.id === id ? null : current));
    }, PET_BUBBLE_MS);
    window.setTimeout(() => {
      setHopId((current) => (current === id ? null : current));
    }, 420);
  };

  useEffect(() => {
    if (prefersReducedMotion()) return;
    let cancelled = false;
    let timer = 0;
    const wait = (delay: number) => {
      timer = window.setTimeout(() => {
        if (cancelled) return;
        const current = bubbleRef.current;
        if (current?.kind === 'usage') {
          wait(600);
          return;
        }
        if (current?.kind === 'sync') {
          setBubble((next) => (next?.kind === 'sync' ? null : next));
          wait(1400 + Math.random() * 1600);
          return;
        }
        const pool = DEMO_PETS.filter((pet) => pet.id !== current?.id);
        const pet = pool[Math.floor(Math.random() * pool.length)] ?? DEMO_PETS[0]!;
        setBubble({ kind: 'sync', id: pet.id, added: randomAddedTokens() });
        wait(PET_BUBBLE_MS);
      }, delay);
    };
    wait(900 + Math.random() * 700);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      clearBubbleTimer();
    };
  }, []);

  return (
    <div className="mt-6 flex w-full items-end justify-center gap-2 sm:mt-8 sm:gap-8">
      {DEMO_PETS.map((pet, index) => {
        const usageOpen = bubble?.kind === 'usage' && bubble.id === pet.id;
        const syncAdded = bubble?.kind === 'sync' && bubble.id === pet.id ? bubble.added : null;
        return (
          <div className="relative flex w-24 flex-col items-center sm:w-28" key={pet.id}>
            {usageOpen ? <PetBubble cost={pet.cost} tokens={pet.tokens} /> : null}
            {syncAdded ? <PetSyncBubble added={syncAdded} /> : null}
            <button
              aria-label={`${pet.name}，点击查看用量`}
              aria-pressed={usageOpen}
              className="group flex cursor-pointer flex-col items-center border-0 bg-transparent p-0 outline-offset-4"
              type="button"
              onClick={() => showBubble(pet.id)}
            >
              <span className="block transition-transform duration-200 ease-out group-hover:-translate-y-1.5 group-hover:scale-105 motion-reduce:transition-none motion-reduce:group-hover:transform-none">
                <img
                  alt=""
                  className={cn(
                    'h-20 w-auto max-w-full object-contain sm:h-24',
                    hopId === pet.id && 'motion-safe:animate-[download-pet-hop_420ms_ease-out]',
                    hopId !== pet.id &&
                      'motion-safe:animate-[download-pet-float_2.8s_ease-in-out_infinite]',
                  )}
                  draggable={false}
                  height={208}
                  src={pet.image}
                  style={{
                    animationDelay: hopId === pet.id ? undefined : `${index * 180}ms`,
                    filter: `drop-shadow(0 8px 12px ${pet.glow}55) drop-shadow(0 0 14px ${pet.accent}44)`,
                  }}
                  width={192}
                />
              </span>
              <span
                className={cn(
                  'mt-1 text-xs font-medium',
                  usageOpen ? 'text-foreground' : 'text-muted',
                )}
              >
                {pet.name}
              </span>
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Screenshot carousel with the three desktop pets underneath. */
export function DownloadPreviewCarousel() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = PREVIEW_SLIDES.length;

  useEffect(() => {
    if (paused || count < 2 || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % count);
    }, PREVIEW_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, count]);

  const active = PREVIEW_SLIDES[index] ?? PREVIEW_SLIDES[0]!;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col items-center">
      <figure
        aria-label="产品预览"
        aria-roledescription="carousel"
        className="w-full overflow-hidden rounded-2xl border border-border/80 bg-surface shadow-[0_24px_48px_-28px_rgb(15_23_42/0.45)] dark:shadow-[0_24px_48px_-24px_rgb(0_0_0/0.65)]"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false);
        }}
        onFocus={() => setPaused(true)}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <div className="relative aspect-[2102/1560] overflow-hidden">
          <div
            className="flex h-full motion-safe:transition-transform motion-safe:duration-500 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            style={{ transform: `translateX(-${index * 100}%)` }}
          >
            {PREVIEW_SLIDES.map((slide) => (
              <div
                aria-hidden={slide.id !== active.id}
                className="h-full w-full shrink-0"
                inert={slide.id !== active.id}
                key={slide.id}
              >
                <img
                  alt={slide.alt}
                  className="h-full w-full object-cover object-top"
                  decoding="async"
                  height={1560}
                  src={slide.src}
                  width={2102}
                />
              </div>
            ))}
          </div>
        </div>
      </figure>
      <p className="mt-3 text-center text-sm font-normal text-foreground">{active.label}</p>
      {count > 1 ? (
        <div
          aria-label="切换预览"
          className="mt-2 flex items-center justify-center gap-1.5"
          role="tablist"
        >
          {PREVIEW_SLIDES.map((slide, slideIndex) => {
            const selected = slideIndex === index;
            return (
              <button
                aria-label={slide.label}
                aria-selected={selected}
                className={cn(
                  'h-1.5 cursor-pointer rounded-full transition-[width,background-color] duration-200',
                  selected ? 'w-6 bg-foreground' : 'w-1.5 bg-foreground/25 hover:bg-foreground/45',
                )}
                key={slide.id}
                role="tab"
                type="button"
                onClick={() => setIndex(slideIndex)}
              />
            );
          })}
        </div>
      ) : null}
      <DownloadPetStage />
    </div>
  );
}
