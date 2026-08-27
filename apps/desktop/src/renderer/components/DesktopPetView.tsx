import { Popover } from '@heroui/react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { fetchSummary } from '@/lib/api';
import { formatTokens, formatTokensExact, formatUsd } from '@/lib/format';
import { getDesktopPet } from '@/pets';
import {
  DESKTOP_PET_SOURCE_HEIGHT,
  DESKTOP_PET_SOURCE_WIDTH,
  getDesktopPetLayout,
} from '../../shared/desktop-pet-layout';

type Animation = 'idle' | 'running-left' | 'running-right';

const CELL_WIDTH = DESKTOP_PET_SOURCE_WIDTH;
const CELL_HEIGHT = DESKTOP_PET_SOURCE_HEIGHT;
const DISPLAY_SCALE = 0.5;
const SPRITESHEET_WIDTH = CELL_WIDTH * 8;
const SPRITESHEET_HEIGHT = CELL_HEIGHT * 11;
const DRAG_ANIMATION_SPEED_MULTIPLIER = 0.55;
const ANIMATION_ROWS: Record<Animation, { row: number; frames: number }> = {
  idle: { row: 0, frames: 6 },
  'running-right': { row: 1, frames: 8 },
  'running-left': { row: 2, frames: 8 },
};

/**
 * Click's generated running-left row contains a corrupt frame with neighboring
 * poses baked into the same cell. Its right-running row is mirror-safe, so use
 * that complete row as the left-running source instead of displaying the
 * damaged pixels.
 */
function getRenderedAnimation(
  selectedPetId: string,
  animation: Animation,
): { source: Animation; mirrorX: boolean } {
  if (selectedPetId === 'click' && animation === 'running-left') {
    return { source: 'running-right', mirrorX: true };
  }
  return { source: animation, mirrorX: false };
}

/** Transparent pet view with manual drag support so click can open its token bubble. */
export function DesktopPetView() {
  const [animation, setAnimation] = useState<Animation>('idle');
  const [frame, setFrame] = useState(0);
  const [selectedPetId, setSelectedPetId] = useState('hawking');
  const [scale, setScale] = useState(DISPLAY_SCALE);
  const [frameIntervalMs, setFrameIntervalMs] = useState(180);
  const [isTokenTooltipOpen, setIsTokenTooltipOpen] = useState(false);
  const [summary, setSummary] = useState<{ totalTokens: number; totalCostUsd: number } | null>(null);
  const [summaryError, setSummaryError] = useState(false);
  const alphaCanvas = useRef<HTMLCanvasElement | null>(null);
  const ignored = useRef(false);
  const dragState = useRef<{
    pointerId: number;
    screenX: number;
    screenY: number;
    moved: boolean;
  } | null>(null);
  const effectiveFrameIntervalMs = animation === 'idle'
    ? frameIntervalMs
    : Math.max(60, Math.round(frameIntervalMs * DRAG_ANIMATION_SPEED_MULTIPLIER));

  /**
   * Frame clock. This deliberately uses a timer rather than a permanent rAF
   * loop: the pet only needs one paint per sprite frame (about 5–17 fps), while
   * rAF keeps a transparent Electron window rendering at the display refresh
   * rate even when the sprite does not change.
   */
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((current) => current + 1);
    }, effectiveFrameIntervalMs);
    return () => window.clearInterval(timer);
  }, [effectiveFrameIntervalMs]);

  useEffect(() => window.tud.onDesktopPetAnimation(setAnimation), []);

  useEffect(() => {
    let cancelled = false;
    void window.tud.getDesktopPet().then((pref) => {
      if (cancelled) return;
      setScale(pref.scale);
      setFrameIntervalMs(pref.frameIntervalMs);
      setSelectedPetId(pref.selectedPetId);
    });
    const unsubscribe = window.tud.onDesktopPetPreferences((pref) => {
      setScale(pref.scale);
      setFrameIntervalMs(pref.frameIntervalMs);
      setSelectedPetId(pref.selectedPetId);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => { alphaCanvas.current = null; }, [selectedPetId]);

  useEffect(() => {
    if (!isTokenTooltipOpen) return;
    let cancelled = false;
    setSummaryError(false);
    void fetchSummary()
      .then((next) => {
        if (cancelled) return;
        setSummary({ totalTokens: next.totalTokens, totalCostUsd: next.totalCostUsd });
      })
      .catch(() => { if (!cancelled) setSummaryError(true); });
    return () => { cancelled = true; };
  }, [isTokenTooltipOpen]);

  const setMouseIgnored = (shouldIgnore: boolean) => {
    if (shouldIgnore === ignored.current) return;
    ignored.current = shouldIgnore;
    window.tud.setDesktopPetMouseIgnored(shouldIgnore);
  };

  const loadAlphaMap = (image: HTMLImageElement) => {
    const canvas = document.createElement('canvas');
    canvas.width = SPRITESHEET_WIDTH;
    canvas.height = SPRITESHEET_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0);
    alphaCanvas.current = canvas;
  };

  const updateMousePassThrough = (event: MouseEvent<HTMLButtonElement>) => {
    if (dragState.current) {
      setMouseIgnored(false);
      return;
    }
    const canvas = alphaCanvas.current;
    if (!canvas) return;
    const renderedAnimation = getRenderedAnimation(selectedPetId, animation);
    const { row, frames } = ANIMATION_ROWS[renderedAnimation.source];
    const pointerX = Math.max(
      0,
      Math.min(CELL_WIDTH - 1, Math.floor(event.nativeEvent.offsetX / scale)),
    );
    const x = renderedAnimation.mirrorX ? CELL_WIDTH - 1 - pointerX : pointerX;
    const y = Math.max(0, Math.min(CELL_HEIGHT - 1, Math.floor(event.nativeEvent.offsetY / scale)));
    const alpha = canvas.getContext('2d', { willReadFrequently: true })
      ?.getImageData((frame % frames) * CELL_WIDTH + x, row * CELL_HEIGHT + y, 1, 1).data[3] ?? 0;
    setMouseIgnored(alpha < 16);
  };

  /**
   * Pointer-down hands the whole drag to main, which polls the OS cursor and
   * moves its own window. The renderer keeps tracking the pointer only to tell
   * a click apart from a drag, and never sends per-move coordinates.
   */
  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    setMouseIgnored(false);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragState.current = {
      pointerId: event.pointerId,
      screenX: event.screenX,
      screenY: event.screenY,
      moved: false,
    };
    window.tud.beginDesktopPetDrag();
  };

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragState.current;
    if (!drag || drag.pointerId !== event.pointerId || drag.moved) return;
    if (
      Math.abs(event.screenX - drag.screenX) > 3
      || Math.abs(event.screenY - drag.screenY) > 3
    ) {
      drag.moved = true;
      setIsTokenTooltipOpen(false);
    }
  };

  const finishDrag = (
    event?: PointerEvent<HTMLButtonElement>,
    cancelled = false,
  ) => {
    const drag = dragState.current;
    if (!drag || (event && drag.pointerId !== event.pointerId)) return;
    dragState.current = null;
    window.tud.endDesktopPetDrag();
    setAnimation('idle');
    if (event && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    if (!cancelled && !drag.moved) setIsTokenTooltipOpen((open) => !open);
  };

  useEffect(() => {
    const cancelDrag = () => finishDrag(undefined, true);
    window.addEventListener('blur', cancelDrag);
    return () => {
      window.removeEventListener('blur', cancelDrag);
      cancelDrag();
    };
  }, []);

  const renderedAnimation = getRenderedAnimation(selectedPetId, animation);
  const { row, frames } = ANIMATION_ROWS[renderedAnimation.source];
  const currentFrame = frame % frames;
  const pet = getDesktopPet(selectedPetId);
  const layout = getDesktopPetLayout(scale);
  const width = layout.spriteWidth;
  const height = layout.spriteHeight;
  return (
    <div className="desktop-pet-root" onMouseMove={(event) => {
      if (!dragState.current && event.target === event.currentTarget) setMouseIgnored(true);
    }}>
      <img alt="" aria-hidden="true" className="hidden" src={pet.spritesheet} onLoad={(event) => loadAlphaMap(event.currentTarget)} />
      <Popover isOpen={isTokenTooltipOpen} onOpenChange={setIsTokenTooltipOpen}>
        <Popover.Trigger
          className="desktop-pet-popover-trigger"
          style={{
            width,
            height,
            left: layout.spriteLeft,
            top: layout.popoverTop,
            '--pet-glow-primary': pet.glow.primary,
            '--pet-glow-accent': pet.glow.accent,
          } as CSSProperties}
        >
          <button
            aria-label={`${pet.displayName} 桌面宠物，点击查看总 Token，拖动可移动`}
            className="desktop-pet-sprite"
            onMouseMove={updateMousePassThrough}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(event) => finishDrag(event)}
            onPointerCancel={(event) => finishDrag(event, true)}
            onLostPointerCapture={(event) => finishDrag(event, true)}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{
              width,
              height,
              backgroundImage: `url(${pet.spritesheet})`,
              backgroundPosition: `${-currentFrame * width}px ${-row * height}px`,
              backgroundSize: `${SPRITESHEET_WIDTH * scale}px ${SPRITESHEET_HEIGHT * scale}px`,
              transform: renderedAnimation.mirrorX ? 'scaleX(-1)' : undefined,
            }}
            type="button"
          />
        </Popover.Trigger>
        <Popover.Content
          className="overflow-hidden rounded-xl bg-surface shadow-lg"
          offset={8}
          placement="top"
          shouldFlip={false}
          style={{ width: layout.popoverWidth }}
        >
          <Popover.Arrow />
          <Popover.Dialog className="grid gap-1 px-3 py-2">
            <PetStatRow
              dotClassName="bg-accent"
              exactLabel={summary ? formatTokensExact(summary.totalTokens) : undefined}
              format={formatTokens}
              label="Token"
              state={summaryError ? 'error' : summary === null ? 'loading' : 'ready'}
              value={summary?.totalTokens ?? 0}
            />
            <PetStatRow
              dotClassName="bg-success"
              format={formatUsd}
              label="费用"
              state={summaryError ? 'error' : summary === null ? 'loading' : 'ready'}
              value={summary?.totalCostUsd ?? 0}
            />
          </Popover.Dialog>
        </Popover.Content>
      </Popover>
    </div>
  );
}

/** One bullet + label + rolling value row inside the pet Popover. */
function PetStatRow({
  dotClassName,
  exactLabel,
  format,
  label,
  state,
  value,
}: {
  dotClassName: string;
  exactLabel?: string;
  format: (value: number) => string;
  label: string;
  state: 'error' | 'loading' | 'ready';
  value: number;
}) {
  // Hold at 0 until data lands so the roll runs once, on the real value.
  const animatedValue = useAnimatedNumber(state === 'ready' ? value : 0);

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex min-w-0 items-center gap-1.5">
        <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${dotClassName}`} />
        <span className="shrink-0 text-[11px] leading-tight text-muted">{label}</span>
      </span>
      <span
        aria-label={exactLabel ? `${label} ${exactLabel}` : undefined}
        className="truncate text-[13px] font-semibold leading-tight tabular-nums"
        title={exactLabel}
      >
        {state === 'error' ? '--' : state === 'loading' ? '…' : format(animatedValue)}
      </span>
    </div>
  );
}
