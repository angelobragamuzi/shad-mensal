"use client";

export const DEFAULT_SITE_ACCENT_COLOR = "#f07f1d";
export const BRANDING_CHANGE_EVENT = "shad-branding-change";

export interface BrandingChangeDetail {
  logoUrl: string;
  accentColor: string;
}

const HEX_COLOR_REGEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function expandHexColor(hexColor: string): string {
  if (hexColor.length !== 4) return hexColor.toLowerCase();

  const [hash, r, g, b] = hexColor;
  return `${hash}${r}${r}${g}${g}${b}${b}`.toLowerCase();
}

export function normalizeHexColor(
  color: string | null | undefined,
  fallback = DEFAULT_SITE_ACCENT_COLOR
): string {
  const value = color?.trim().toLowerCase() ?? "";
  if (!HEX_COLOR_REGEX.test(value)) return fallback;
  return expandHexColor(value);
}

function hexToRgb(hexColor: string): { r: number; g: number; b: number } {
  const safeHex = normalizeHexColor(hexColor);
  const hex = safeHex.slice(1);
  return {
    r: Number.parseInt(hex.slice(0, 2), 16),
    g: Number.parseInt(hex.slice(2, 4), 16),
    b: Number.parseInt(hex.slice(4, 6), 16),
  };
}

function channelToHex(channel: number): string {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
}

function mixHex(baseColor: string, mixColor: string, amount: number): string {
  const safeAmount = Math.max(0, Math.min(1, amount));
  const base = hexToRgb(baseColor);
  const mix = hexToRgb(mixColor);

  const r = base.r + (mix.r - base.r) * safeAmount;
  const g = base.g + (mix.g - base.g) * safeAmount;
  const b = base.b + (mix.b - base.b) * safeAmount;

  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`;
}

function getContrastInk(hexColor: string): string {
  const { r, g, b } = hexToRgb(hexColor);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.62 ? "#111111" : "#f9f9f9";
}

function toRgba(hexColor: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hexColor);
  const safeAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${safeAlpha})`;
}

export function buildBrandCssVariables(hexColor: string): Record<string, string> {
  const accent = normalizeHexColor(hexColor);
  return {
    "--accent": accent,
    "--accent-hover": mixHex(accent, "#000000", 0.14),
    "--accent-ink": getContrastInk(accent),
    "--focus": toRgba(accent, 0.34),
  };
}

export function emitBrandingChange(detail: BrandingChangeDetail): void {
  if (typeof window === "undefined") return;
  const payload: BrandingChangeDetail = {
    logoUrl: detail.logoUrl.trim(),
    accentColor: normalizeHexColor(detail.accentColor),
  };
  window.dispatchEvent(new CustomEvent<BrandingChangeDetail>(BRANDING_CHANGE_EVENT, { detail: payload }));
}
