"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const storageKey = "shad-theme";
const eventName = "shad-theme-change";

function readSavedTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  const savedTheme = window.localStorage.getItem(storageKey);
  return savedTheme === "light" || savedTheme === "dark" ? savedTheme : null;
}

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(): Theme {
  if (typeof document !== "undefined") {
    const current = document.documentElement.getAttribute("data-theme");
    if (current === "light" || current === "dark") {
      return current;
    }
  }

  return readSavedTheme() ?? getSystemTheme();
}

function writeTheme(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  document.documentElement.style.colorScheme = theme;
  window.localStorage.setItem(storageKey, theme);
  window.dispatchEvent(new CustomEvent<Theme>(eventName, { detail: theme }));
}

interface ThemeToggleProps {
  className?: string;
  compact?: boolean;
}

export function ThemeToggle({ className = "", compact = false }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(resolveTheme);

  useEffect(() => {
    const onThemeChange = (event: Event) => {
      const detail = (event as CustomEvent<Theme>).detail;
      if (detail === "light" || detail === "dark") {
        setTheme(detail);
        return;
      }
      setTheme(resolveTheme());
    };

    window.addEventListener(eventName, onThemeChange);
    return () => {
      window.removeEventListener(eventName, onThemeChange);
    };
  }, []);

  const handleToggle = () => {
    const current = resolveTheme();
    const nextTheme: Theme = current === "dark" ? "light" : "dark";
    writeTheme(nextTheme);
    setTheme(nextTheme);
  };

  const isDark = theme === "dark";
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Tema claro" : "Tema escuro";

  return (
    <button
      type="button"
      onClick={handleToggle}
      className={[
        "btn-muted inline-flex items-center justify-center gap-2 px-3 text-xs font-medium",
        compact ? "h-9" : "h-10",
        className,
      ].join(" ")}
      aria-label={label}
      title={label}
    >
      <Icon size={14} />
      {compact ? null : <span>{label}</span>}
    </button>
  );
}
