import { useState, useEffect } from "react";
import "./Editor.css";

const CLIPS = [
  { id: 1, label: "Intro", start: 0, end: 18, color: "#7c3aed" },
  { id: 2, label: "Content", start: 18, end: 65, color: "#0ea5e9" },
  { id: 3, label: "Outro", start: 65, end: 80, color: "#a855f7" },
];

const TOTAL = 80; // seconds

function Editor() {
  const [playhead, setPlayhead] = useState(12);
  const [selected, setSelected] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let interval;
    if (isPlaying) {
      interval = setInterval(() => {
        setPlayhead((prev) => {
          if (prev >= TOTAL) {
            setIsPlaying(false);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const formatTime = (s) => {
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = (s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const handleTrackClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    setPlayhead(Math.round(ratio * TOTAL));
  };

  return (
    <div className="editor-page">
      <div className="page-header">
        <h1>Editor</h1>
        <p>Trim, annotate and export your recordings.</p>
      </div>

      <div className="editor-layout">
        {/* ── Left: Preview + tools ── */}
        <div className="editor-main">

          {/* Preview */}
          <div className="editor-preview">
            <div className="preview-inner">
              <span className="preview-icon">🎬</span>
              <p>Product Demo — Q3 Launch</p>
              <span className="preview-time">{formatTime(playhead)}</span>
            </div>
          </div>

          {/* Playback controls */}
          <div className="playback-bar">
            <button className="pb-btn" onClick={() => setPlayhead(0)}>⏮</button>
            <button className="pb-btn" onClick={() => setPlayhead((prev) => Math.max(0, prev - 5))}>⏪</button>
            <button className="pb-btn primary" onClick={() => setIsPlaying(!isPlaying)}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button className="pb-btn" onClick={() => setPlayhead((prev) => Math.min(TOTAL, prev + 5))}>⏩</button>
            <button className="pb-btn" onClick={() => setPlayhead(TOTAL)}>⏭</button>
            <span className="pb-time">{formatTime(playhead)} / {formatTime(TOTAL)}</span>
            <div className="volume-control">
              <span>🔊</span>
              <input type="range" min="0" max="100" defaultValue="80" />
            </div>
          </div>

          {/* ── Timeline ── */}
          <div className="timeline-wrapper">
            <div className="timeline-header">
              <span className="tl-label">Timeline</span>
              <div className="tl-actions">
                <button className="tl-btn">✂️ Split</button>
                <button className="tl-btn">🗑️ Delete</button>
                <button className="tl-btn">🎨 Color</button>
              </div>
            </div>

            <div className="timeline-track" onClick={handleTrackClick}>
              {/* Clips */}
              {CLIPS.map((clip) => (
                <div
                  key={clip.id}
                  className={`clip ${selected === clip.id ? "selected" : ""}`}
                  style={{
                    left: `${(clip.start / TOTAL) * 100}%`,
                    width: `${((clip.end - clip.start) / TOTAL) * 100}%`,
                    background: clip.color,
                  }}
                  onClick={(e) => { e.stopPropagation(); setSelected(clip.id); }}
                >
                  <span className="clip-label">{clip.label}</span>
                </div>
              ))}

              {/* Playhead */}
              <div
                className="playhead"
                style={{ left: `${(playhead / TOTAL) * 100}%` }}
              >
                <div className="playhead-line" />
                <div className="playhead-head" />
              </div>
            </div>

            {/* Time ruler */}
            <div className="time-ruler">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                  {formatTime(Math.round((i / 8) * TOTAL))}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Properties panel ── */}
        <div className="editor-panel">
          <h3 className="panel-title">Properties</h3>

          {selected ? (
            <>
              <div className="prop-group">
                <label>Clip Name</label>
                <input
                  type="text"
                  defaultValue={CLIPS.find((c) => c.id === selected)?.label}
                />
              </div>
              <div className="prop-group">
                <label>Start Time</label>
                <input
                  type="text"
                  defaultValue={formatTime(CLIPS.find((c) => c.id === selected)?.start)}
                />
              </div>
              <div className="prop-group">
                <label>End Time</label>
                <input
                  type="text"
                  defaultValue={formatTime(CLIPS.find((c) => c.id === selected)?.end)}
                />
              </div>
              <div className="prop-group">
                <label>Speed</label>
                <select defaultValue="1x">
                  <option>0.5x</option>
                  <option>1x</option>
                  <option>1.5x</option>
                  <option>2x</option>
                </select>
              </div>
            </>
          ) : (
            <div className="panel-placeholder">
              <span>🎞️</span>
              <p>Click a clip to edit its properties</p>
            </div>
          )}

          <div className="export-section">
            <h3 className="panel-title">Export</h3>
            <div className="prop-group">
              <label>Format</label>
              <select defaultValue="mp4">
                <option value="mp4">MP4 (H.264)</option>
                <option value="webm">WebM (VP9)</option>
                <option value="mov">MOV (ProRes)</option>
              </select>
            </div>
            <div className="prop-group">
              <label>Resolution</label>
              <select defaultValue="1080">
                <option value="720">720p</option>
                <option value="1080">1080p</option>
                <option value="4k">4K</option>
              </select>
            </div>
            <button className="export-btn">⬇ Export Video</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Editor;
