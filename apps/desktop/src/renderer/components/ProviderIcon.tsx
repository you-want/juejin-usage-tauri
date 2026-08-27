import type { CSSProperties, ReactNode } from 'react';
import antigravityIcon from '@lobehub/icons-static-svg/icons/antigravity-color.svg';
import ampIcon from '@lobehub/icons-static-svg/icons/amp-color.svg';
import claudeIcon from '@lobehub/icons-static-svg/icons/claude-color.svg';
import clineIcon from '@lobehub/icons-static-svg/icons/cline.svg';
import codeBuddyIcon from '@lobehub/icons-static-svg/icons/codebuddy-color.svg';
import codexIcon from '@lobehub/icons-static-svg/icons/codex.svg';
import copilotIcon from '@lobehub/icons-static-svg/icons/copilot-color.svg';
import cursorIcon from '@lobehub/icons-static-svg/icons/cursor.svg';
import devinIcon from '@lobehub/icons-static-svg/icons/devin-color.svg';
import geminiIcon from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import geminiCliIcon from '@lobehub/icons-static-svg/icons/geminicli-color.svg';
import gooseIcon from '@lobehub/icons-static-svg/icons/goose.svg';
import grokIcon from '@lobehub/icons-static-svg/icons/grok.svg';
import hermesIcon from '@lobehub/icons-static-svg/icons/hermesagent.svg';
import kimiIcon from '@lobehub/icons-static-svg/icons/kimi-color.svg';
import kilocodeIcon from '@lobehub/icons-static-svg/icons/kilocode.svg';
import kiroIcon from '@lobehub/icons-static-svg/icons/kiro-color.svg';
import openClawIcon from '@lobehub/icons-static-svg/icons/openclaw-color.svg';
import openCodeIcon from '@lobehub/icons-static-svg/icons/opencode.svg';
import piIcon from '@lobehub/icons-static-svg/icons/pi.svg';
import qoderIcon from '@lobehub/icons-static-svg/icons/qoder-color.svg';
import qwenIcon from '@lobehub/icons-static-svg/icons/qwen-color.svg';
import roocodeIcon from '@lobehub/icons-static-svg/icons/roocode.svg';
import traeIcon from '@lobehub/icons-static-svg/icons/trae-color.svg';
import windsurfIcon from '@lobehub/icons-static-svg/icons/windsurf.svg';
import xiaomiMimoIcon from '@lobehub/icons-static-svg/icons/xiaomimimo.svg';
import zaiIcon from '@lobehub/icons-static-svg/icons/zai.svg';

interface ProviderIconAsset {
  monochrome?: boolean;
  src: string;
}

const PROVIDER_ICON_MAP: Record<string, ProviderIconAsset> = {
  amp: { src: ampIcon },
  antigravity: { src: antigravityIcon },
  'claude-code': { src: claudeIcon },
  cline: { monochrome: true, src: clineIcon },
  codebuddy: { src: codeBuddyIcon },
  codex: { monochrome: true, src: codexIcon },
  'every-code': { monochrome: true, src: codexIcon },
  copilot: { src: copilotIcon },
  cursor: { monochrome: true, src: cursorIcon },
  devin: { src: devinIcon },
  gemini: { src: geminiIcon },
  'gemini-cli': { src: geminiCliIcon },
  grok: { monochrome: true, src: grokIcon },
  goose: { monochrome: true, src: gooseIcon },
  hermes: { monochrome: true, src: hermesIcon },
  kimi: { src: kimiIcon },
  'kilo-cli': { monochrome: true, src: kilocodeIcon },
  kilocode: { monochrome: true, src: kilocodeIcon },
  kiro: { src: kiroIcon },
  mimo: { monochrome: true, src: xiaomiMimoIcon },
  openclaw: { src: openClawIcon },
  opencode: { monochrome: true, src: openCodeIcon },
  pi: { monochrome: true, src: piIcon },
  qoder: { src: qoderIcon },
  qwen: { src: qwenIcon },
  'qwen-code': { src: qwenIcon },
  roocode: { monochrome: true, src: roocodeIcon },
  trae: { src: traeIcon },
  windsurf: { monochrome: true, src: windsurfIcon },
  workbuddy: { src: codeBuddyIcon },
  zcode: { monochrome: true, src: zaiIcon },
};

const PROVIDER_ALIASES: Record<string, string> = {
  'code-buddy': 'codebuddy',
  everycode: 'every-code',
  'github-copilot': 'copilot',
  'grok-build': 'grok',
  'kilo-code': 'kilocode',
  kilo: 'kilo-cli',
  mimocode: 'mimo',
  'oh-my-pi': 'omp',
  'open-claw': 'openclaw',
  'open-code': 'opencode',
  'openai-codex': 'codex',
  'roo-code': 'roocode',
  zai: 'zcode',
  'hermes-agent': 'hermes',
  'kimi-code': 'kimi',
  'kimi-legacy': 'kimi',
  'pi-coding-agent': 'pi',
  factory: 'droid',
};

/** Collapse local collector names and server integration slugs to one icon key. */
function normalizeProviderKey(provider: string): string {
  const key = provider.trim().toLowerCase().replace(/[\s_]+/g, '-');

  if (key === 'claude-code' || key.startsWith('claude')) return 'claude-code';
  if (key === 'codex' || key.startsWith('codex-')) return 'codex';
  if (key === 'cursor' || key.startsWith('cursor-')) return 'cursor';
  if (key === 'gemini' || key === 'gemini-cli' || key.startsWith('gemini-')) {
    return 'gemini-cli';
  }
  if (key === 'copilot' || key === 'copilot-cli' || key.startsWith('copilot-')) {
    return 'copilot';
  }
  if (key === 'opencode' || key.startsWith('opencode-')) return 'opencode';
  if (key.startsWith('antigravity')) return 'antigravity';
  if (key.startsWith('openclaw')) return 'openclaw';
  if (key.startsWith('hermes')) return 'hermes';
  if (key.startsWith('kimi')) return 'kimi';
  if (key.startsWith('kiro')) return 'kiro';
  if (key === 'roo-code' || key.startsWith('roocode') || key.startsWith('roo-')) {
    return 'roocode';
  }
  if (key.startsWith('zcode') || key === 'zai') return 'zcode';
  if (key === 'pi-coding-agent' || key.startsWith('pi-') || key === 'pi') return 'pi';
  if (key.startsWith('droid') || key.startsWith('factory')) return 'droid';
  if (key.startsWith('qoder')) return 'qoder';
  if (key.startsWith('trae')) return 'trae';
  if (key.startsWith('amp')) return 'amp';
  if (key.startsWith('qwen')) return 'qwen-code';
  if (key.startsWith('codebuddy') || key === 'code-buddy') return 'codebuddy';
  if (key.startsWith('workbuddy')) return 'workbuddy';
  if (key.startsWith('grok')) return 'grok';
  if (key.startsWith('goose')) return 'goose';
  if (key.startsWith('mimo') || key === 'mimocode' || key.startsWith('xiaomi')) return 'mimo';
  if (key === 'everycode' || key.startsWith('every-code')) return 'every-code';
  if (key.startsWith('omp') || key === 'oh-my-pi') return 'omp';
  if (key.startsWith('kilo-cli') || key === 'kilo') return 'kilo-cli';
  if (key.startsWith('kilocode') || key === 'kilo-code') return 'kilocode';
  if (key.startsWith('zed')) return 'zed';
  if (key.startsWith('warp')) return 'warp';

  return PROVIDER_ALIASES[key] ?? key;
}

interface ProviderIconProps {
  provider: string;
  size?: number;
  className?: string;
  /** Keep monochrome brand marks dark when the caller provides a light badge. */
  onLightBackground?: boolean;
  /** Render a high-contrast variant for a selected colored background. */
  isSelected?: boolean;
  /** Used by the neutral fallback icon. */
  color?: string;
}

export function ProviderIcon({
  provider,
  size = 16,
  className = '',
  onLightBackground = false,
  isSelected = false,
  color,
}: ProviderIconProps) {
  const key = normalizeProviderKey(provider);
  const asset = PROVIDER_ICON_MAP[key];

  if (asset) {
    return (
      <img
        alt=""
        aria-hidden
        className={`shrink-0 object-contain ${
          asset.monochrome
            ? isSelected
              ? 'invert'
              : !onLightBackground
                ? 'dark:invert'
                : ''
            : ''
        } ${className}`}
        height={size}
        src={asset.src}
        style={{ height: size, width: size }}
        width={size}
      />
    );
  }

  if (key === 'droid') {
    return (
      <DroidIcon
        className={className}
        size={size}
        style={{ color }}
      />
    );
  }

  if (key === 'omp') {
    return (
      <OmpIcon
        className={className}
        size={size}
        style={{ color }}
      />
    );
  }

  if (key === 'zed') {
    return (
      <ZedIcon
        className={className}
        size={size}
        style={{ color }}
      />
    );
  }

  if (key === 'warp') {
    return (
      <WarpIcon
        className={className}
        size={size}
        style={{ color }}
      />
    );
  }

  return <PlaceholderIcon className={className} size={size} style={{ color }} />;
}

function OmpIcon({
  className,
  size,
  style,
}: {
  className: string;
  size: number;
  style?: CSSProperties;
}): ReactNode {
  return (
    <svg
      aria-hidden
      className={`shrink-0 ${className}`}
      fill="currentColor"
      height={size}
      style={style}
      viewBox="0 0 120 90"
      width={size}
    >
      <rect height="12" rx="2" width="100" x="10" y="8" />
      <rect height="62" rx="2" width="12" x="25" y="20" />
      <rect height="45" rx="2" width="12" x="75" y="20" />
      <rect height="16" rx="3" width="20" x="71" y="55" />
      <rect height="8" rx="1" width="3" x="76" y="71" />
      <rect height="8" rx="1" width="3" x="82" y="71" />
    </svg>
  );
}

function ZedIcon({
  className,
  size,
  style,
}: {
  className: string;
  size: number;
  style?: CSSProperties;
}): ReactNode {
  return (
    <svg
      aria-hidden
      className={`shrink-0 ${className}`}
      fill="currentColor"
      height={size}
      style={style}
      viewBox="0 0 16 16"
      width={size}
    >
      <path
        clipRule="evenodd"
        d="M3.125 2.75C2.9179 2.75 2.75 2.9179 2.75 3.125V11.375H2V3.125C2 2.50368 2.50368 2 3.125 2H13.1723C13.6735 2 13.9244 2.6059 13.5701 2.96025L7.38189 9.14843H9.125V8.375H9.875V9.33593C9.875 9.6466 9.6232 9.8984 9.3125 9.8984H6.63189L5.34282 11.1875H11.1875V6.5H11.9375V11.1875C11.9375 11.6017 11.6017 11.9375 11.1875 11.9375H4.59282L3.28032 13.25H12.875C13.0821 13.25 13.25 13.0821 13.25 12.875V4.625H14V12.875C14 13.4963 13.4963 14 12.875 14H2.82767C2.32653 14 2.07557 13.3941 2.42992 13.0397L8.59468 6.875H6.875V7.625H6.125V6.6875C6.125 6.37684 6.37684 6.125 6.6875 6.125H9.34468L10.6571 4.8125H4.8125V9.5H4.0625V4.8125C4.0625 4.39829 4.39829 4.0625 4.8125 4.0625H11.4071L12.7197 2.75H3.125Z"
        fillRule="evenodd"
      />
    </svg>
  );
}

function WarpIcon({
  className,
  size,
  style,
}: {
  className: string;
  size: number;
  style?: CSSProperties;
}): ReactNode {
  return (
    <svg
      aria-hidden
      className={`shrink-0 ${className}`}
      fill="currentColor"
      height={size}
      style={style}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M4.2 5.5h3.1l2.05 8.2 2.15-8.2h2.9l2.15 8.2 2.05-8.2h3.1L17.3 18.5h-3.05L12 10.2l-2.25 8.3H6.7L4.2 5.5Z" />
    </svg>
  );
}

function DroidIcon({
  className,
  size,
  style,
}: {
  className: string;
  size: number;
  style?: CSSProperties;
}): ReactNode {
  return (
    <svg
      aria-hidden
      className={`shrink-0 ${className}`}
      fill="none"
      height={size}
      style={style}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="M9 3v2" />
      <path d="M15 3v2" />
      <rect height="13" rx="3" width="16" x="4" y="6" />
      <circle cx="9" cy="13" fill="currentColor" r="1.4" stroke="none" />
      <circle cx="15" cy="13" fill="currentColor" r="1.4" stroke="none" />
      <path d="M9 16h6" />
    </svg>
  );
}

function PlaceholderIcon({
  className,
  size,
  style,
}: {
  className: string;
  size: number;
  style: CSSProperties;
}) {
  return (
    <svg
      aria-hidden
      className={`shrink-0 ${className}`}
      fill="none"
      height={size}
      style={style}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle
        cx="12"
        cy="12"
        r="7.5"
        stroke="currentColor"
        strokeDasharray="3 3"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.5"
      />
    </svg>
  );
}
