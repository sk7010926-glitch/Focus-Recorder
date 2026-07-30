import { useState, useEffect } from "react";

export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem("focusRecorderTheme") || "system";
  });

  // Sync state when localStorage changes in other tabs or the same tab
  useEffect(() => {
    const handleSync = () => {
      setThemeState(localStorage.getItem("focusRecorderTheme") || "system");
    };
    
    window.addEventListener("storage", handleSync);
    window.addEventListener("focusRecorderThemeChanged", handleSync);
    
    return () => {
      window.removeEventListener("storage", handleSync);
      window.removeEventListener("focusRecorderThemeChanged", handleSync);
    };
  }, []);

  // Apply theme to DOM and listen for OS changes
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    
    const apply = () => {
      // Remove both classes to ensure a clean slate
      root.classList.remove("light", "dark");
      
      if (theme === "system") {
        root.classList.add(mediaQuery.matches ? "dark" : "light");
      } else {
        root.classList.add(theme); // "light" or "dark"
      }
    };

    apply();
    
    // Listen for OS theme changes
    mediaQuery.addEventListener("change", apply);
    return () => mediaQuery.removeEventListener("change", apply);
  }, [theme]);

  // Setter function updates storage, state, and dispatches sync event
  const setTheme = (newTheme) => {
    localStorage.setItem("focusRecorderTheme", newTheme);
    setThemeState(newTheme);
    window.dispatchEvent(new Event("focusRecorderThemeChanged"));
  };

  return [theme, setTheme];
}
