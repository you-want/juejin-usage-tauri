export const DESKTOP_PET_SOURCE_WIDTH = 192;
export const DESKTOP_PET_SOURCE_HEIGHT = 208;
export const DESKTOP_PET_POPOVER_WIDTH = 136;
/**
 * Headroom above the sprite for the two-row bubble. HeroUI caps
 * `Popover.Content` at the space actually available, so this has to cover the
 * bubble, its arrow, and the trigger offset — otherwise rows spill outside the
 * bubble background instead of the window simply growing.
 */
export const DESKTOP_PET_POPOVER_TOP_SPACE = 116;
export const DESKTOP_PET_HORIZONTAL_GUTTER = 12;

export interface DesktopPetLayout {
  hostWidth: number;
  hostHeight: number;
  spriteWidth: number;
  spriteHeight: number;
  spriteLeft: number;
  spriteTop: number;
  popoverWidth: number;
  popoverTop: number;
}

/** Single source of truth for the native host, sprite, and Popover centerline. */
export function getDesktopPetLayout(scale: number): DesktopPetLayout {
  const spriteWidth = Math.round(DESKTOP_PET_SOURCE_WIDTH * scale);
  const spriteHeight = Math.round(DESKTOP_PET_SOURCE_HEIGHT * scale);
  const topSpace = DESKTOP_PET_POPOVER_TOP_SPACE;
  const hostWidth = Math.max(
    spriteWidth,
    DESKTOP_PET_POPOVER_WIDTH + DESKTOP_PET_HORIZONTAL_GUTTER * 2,
  );

  return {
    hostWidth,
    hostHeight: spriteHeight + topSpace,
    spriteWidth,
    spriteHeight,
    spriteLeft: Math.round((hostWidth - spriteWidth) / 2),
    spriteTop: topSpace,
    popoverWidth: DESKTOP_PET_POPOVER_WIDTH,
    popoverTop: topSpace,
  };
}
