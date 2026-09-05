import type { CSSProperties } from "react";

export type DashboardTheme = "fox" | "custom";

export const THEME_STORAGE_KEY = "dashboard_theme";
export const CUSTOM_ACCENT_STORAGE_KEY = "dashboard_custom_accent";
export const DEFAULT_CUSTOM_ACCENT = "#4f46e5";

/** Build the full accessible accent palette from the user's single color. */
export function customAccentVariables(hex: string): CSSProperties {
  const value = hex.replace("#", "");
  const rgb = [0, 2, 4].map((offset) =>
    Number.parseInt(value.slice(offset, offset + 2), 16),
  );
  const luminance =
    (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  const mix = (target: number, amount: number) =>
    `#${rgb
      .map((channel) =>
        Math.round(channel + (target - channel) * amount)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;

  return {
    "--accent-solid": hex,
    "--accent-border": mix(255, 0.18),
    "--accent-text": mix(255, 0.38),
    "--accent-surface": mix(0, 0.72),
    "--accent-surface-strong": mix(0, 0.56),
    "--accent-rgb": rgb.join(", "),
    "--accent-contrast": luminance > 0.58 ? "#111827" : "#ffffff",
  } as CSSProperties;
}

export function loadStoredTheme() {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "custom" || stored === "indigo" ? "custom" : "fox";
}

export function loadStoredAccent() {
  return localStorage.getItem(CUSTOM_ACCENT_STORAGE_KEY) ?? DEFAULT_CUSTOM_ACCENT;
}
