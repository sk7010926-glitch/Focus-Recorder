import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

export default function GlobalShortcuts() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function handleKeyDown(e) {
      // Ignore if user is typing in an input or textarea
      const tag = e.target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;

      // Only fire when Ctrl+Shift+<key> with no other modifiers
      if (!e.ctrlKey || !e.shiftKey || e.altKey || e.metaKey) return;

      const key = e.key.toUpperCase();

      if (key === "R") {
        e.preventDefault();
        if (location.pathname === "/recorder") {
          // If already on the recorder page, dispatch event to start
          window.dispatchEvent(new Event("app:shortcut:start"));
        } else {
          // Navigate to recorder and trigger auto-start
          navigate("/recorder", { state: { autoStart: true } });
        }
      } else if (key === "S") {
        e.preventDefault();
        window.dispatchEvent(new Event("app:shortcut:stop"));
      } else if (key === "P") {
        e.preventDefault();
        window.dispatchEvent(new Event("app:shortcut:toggle-pause"));
      } else if (key === "L") {
        e.preventDefault();
        if (location.pathname !== "/library") {
          navigate("/library");
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [navigate, location.pathname]);

  return null; // This component does not render anything
}
