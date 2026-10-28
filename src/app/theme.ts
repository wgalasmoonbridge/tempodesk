import { useEffect, useState } from "react";
import type { ThemeSetting } from "../lib/types";

export function useResolvedTheme(setting: ThemeSetting): "light" | "dark" {
  const [systemDark, setSystemDark] = useState(() => {
    try {
      return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", listener);
    setSystemDark(media.matches);
    return () => media.removeEventListener("change", listener);
  }, []);

  if (setting === "light") return "light";
  if (setting === "dark") return "dark";
  return systemDark ? "dark" : "light";
}

export function useAppliedTheme(setting: ThemeSetting) {
  const resolved = useResolvedTheme(setting);
  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);
  return resolved;
}
