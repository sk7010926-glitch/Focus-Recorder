import { useState, useEffect, useRef, useCallback } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { getRecording } from "../services/db";
import { exportVideo } from "../services/videoExport";
import "./Editor.css";

const DEFAULT_COLOR_SETTINGS = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
};

function Editor() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const idStr = searchParams.get("id");
  const recordingId = idStr ? Number(idStr) : null;

  const [recording, setRecording] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [playhead, setPlayhead] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [selected, setSelected] = useState(null);
  const [clips, setClips] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState("1x");

  // Color Editing State (Stage 4)
  const [colorSettings, setColorSettings] = useState(DEFAULT_COLOR_SETTINGS);
  const [showColorPanel, setShowColorPanel] = useState(false);

  // Export State (Stage 5)
  const [exportResolution, setExportResolution] = useState("1080");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState(null);
  const exportCancelRef = useRef({ cancelled: false });

  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const hasInitializedClips = useRef(false);

  const videoFilterStyle = `brightness(${colorSettings.brightness}%) contrast(${colorSettings.contrast}%) saturate(${colorSettings.saturation}%) grayscale(${colorSettings.grayscale}%)`;

  // 1. Fetch recording details from IndexedDB
  useEffect(() => {
    if (!recordingId) {
      setIsLoading(false);
      return;
    }

    let active = true;
    setIsLoading(true);
    setError(null);

    getRecording(recordingId)
      .then((rec) => {
        if (!active) return;
        if (!rec) {
          setError("Recording not found in database.");
          setIsLoading(false);
          return;
        }
        // Create Object URL from the blob
        const url = URL.createObjectURL(rec.blob);
        setRecording(rec);
        setVideoUrl(url);
        setIsLoading(false);
      })
      .catch((err) => {
        console.error("Error loading recording:", err);
        if (active) {
          setError("Failed to load recording from database.");
          setIsLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [recordingId]);

  // 2. Clean up the object URL to prevent memory leaks
  useEffect(() => {
    return () => {
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
    };
  }, [videoUrl]);

  // 3. Keep video volume synchronized with state
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume;
    }
  }, [videoUrl, volume]);

  // 4. Initialize clips array when duration becomes available if not already done
  useEffect(() => {
    if (duration > 0 && clips.length === 0 && !hasInitializedClips.current) {
      hasInitializedClips.current = true;
      const initialSeg = {
        id: "seg_1",
        name: "Segment 1",
        startTime: 0,
        endTime: duration,
        color: "#7c3aed",
      };
      setClips([initialSeg]);
      setSelected(initialSeg.id);
    }
  }, [duration, clips.length]);

  const formatTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // Playback Control Handlers
  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused) {
      vid.play().catch((err) => console.error("Playback failed:", err));
    } else {
      vid.pause();
    }
  };

  const handleBackward = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, vid.currentTime - 5);
    setPlayhead(vid.currentTime);
  };

  const handleForward = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.min(duration, vid.currentTime + 5);
    setPlayhead(vid.currentTime);
  };

  const handleStart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = 0;
    setPlayhead(0);
  };

  const handleEnd = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = duration;
    setPlayhead(duration);
  };

  const handleVolumeChange = (e) => {
    const val = parseFloat(e.target.value) / 100;
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
    }
  };

  const handlePlaybackSpeedChange = (e) => {
    const speedStr = e.target.value;
    setPlaybackSpeed(speedStr);
    const speedVal = parseFloat(speedStr.replace("x", ""));
    if (videoRef.current) {
      videoRef.current.playbackRate = speedVal;
    }
  };

  const handleTrackClick = (e) => {
    const vid = videoRef.current;
    if (!vid || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const newTime = ratio * duration;
    vid.currentTime = newTime;
    setPlayhead(newTime);
  };

  // ── requestAnimationFrame loop for smooth playhead sync ──
  const syncPlayhead = useCallback(() => {
    if (videoRef.current) {
      setPlayhead(videoRef.current.currentTime);
    }
    rafRef.current = requestAnimationFrame(syncPlayhead);
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(syncPlayhead);
  }, [syncPlayhead]);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Cancel rAF on unmount
  useEffect(() => {
    return () => stopRaf();
  }, [stopRaf]);

  // Video Event Handlers
  const handlePlay = () => {
    setIsPlaying(true);
    startRaf();
  };
  const handlePause = () => {
    setIsPlaying(false);
    stopRaf();
    if (videoRef.current) {
      setPlayhead(videoRef.current.currentTime);
    }
  };
  const handleTimeUpdate = () => {
    if (videoRef.current && !rafRef.current) {
      setPlayhead(videoRef.current.currentTime);
    }
  };
  const handleVideoEnded = () => {
    setIsPlaying(false);
    stopRaf();
    if (videoRef.current) {
      setPlayhead(videoRef.current.currentTime);
    }
  };
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    if (vid) {
      const raw = vid.duration;
      const vidDuration = isFinite(raw) && raw > 0 ? raw : 0;
      setDuration(vidDuration);
      setPlayhead(vid.currentTime);
      if (!hasInitializedClips.current && vidDuration > 0) {
        hasInitializedClips.current = true;
        const initialSeg = {
          id: "seg_1",
          name: "Segment 1",
          startTime: 0,
          endTime: vidDuration,
          color: "#7c3aed",
        };
        setClips([initialSeg]);
        setSelected(initialSeg.id);
      }
    }
  };

  // ── STAGE 3 EDITING ACTIONS: SPLIT, DELETE, TRIM ──

  // Check if playhead is inside any segment with at least 0.2s clearance from edges
  const currentSegmentToSplit = clips.find(
    (c) => playhead > c.startTime + 0.2 && playhead < c.endTime - 0.2
  );
  const canSplit = Boolean(currentSegmentToSplit);

  // SPLIT
  const handleSplit = () => {
    const vid = videoRef.current;
    const splitTime = vid ? vid.currentTime : playhead;

    const targetSeg = clips.find(
      (c) => splitTime > c.startTime && splitTime < c.endTime
    );

    if (!targetSeg) {
      alert("Please place the playhead inside a segment to split.");
      return;
    }

    const MIN_LEN = 0.2;
    if (
      splitTime - targetSeg.startTime < MIN_LEN ||
      targetSeg.endTime - splitTime < MIN_LEN
    ) {
      alert(`Cannot split: segments must be at least ${MIN_LEN}s long.`);
      return;
    }

    const seg1 = {
      ...targetSeg,
      endTime: splitTime,
    };

    const newId = `seg_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const seg2 = {
      id: newId,
      name: `Segment ${clips.length + 1}`,
      startTime: splitTime,
      endTime: targetSeg.endTime,
      color: targetSeg.color || "#7c3aed",
    };

    const updated = clips.flatMap((c) =>
      c.id === targetSeg.id ? [seg1, seg2] : [c]
    );
    updated.sort((a, b) => a.startTime - b.startTime);

    setClips(updated);
    setSelected(seg2.id);
  };

  // DELETE
  const handleDeleteSegment = () => {
    if (!selected) return;
    const targetSeg = clips.find((c) => c.id === selected);
    if (!targetSeg) return;

    const confirmDelete = window.confirm(
      `Are you sure you want to delete "${targetSeg.name}"?`
    );
    if (!confirmDelete) return;

    const updated = clips.filter((c) => c.id !== selected);
    setClips(updated);
    setSelected(null);
  };

  // TRIM HANDLERS
  const handleTrimStart = (id, newStart) => {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id !== id) return c;
        let validStart = newStart;
        if (validStart < 0) validStart = 0;
        if (validStart >= c.endTime - 0.1) validStart = c.endTime - 0.1;
        if (validStart > duration) validStart = duration;
        return { ...c, startTime: validStart };
      })
    );
    if (videoRef.current) {
      const safeStart = Math.max(0, newStart);
      videoRef.current.currentTime = safeStart;
      setPlayhead(safeStart);
    }
  };

  const handleTrimEnd = (id, newEnd) => {
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id !== id) return c;
        let validEnd = newEnd;
        if (validEnd > duration) validEnd = duration;
        if (validEnd <= c.startTime + 0.1) validEnd = c.startTime + 0.1;
        if (validEnd < 0) validEnd = 0;
        return { ...c, endTime: validEnd };
      })
    );
    if (videoRef.current) {
      const safeEnd = Math.min(duration, newEnd);
      videoRef.current.currentTime = safeEnd;
      setPlayhead(safeEnd);
    }
  };

  // VISUAL TRIM DRAG HANDLES ON TIMELINE
  const handleDragHandle = (e, clip, handleType) => {
    e.stopPropagation();
    e.preventDefault();
    const track = e.currentTarget.closest(".timeline-track");
    if (!track || !duration) return;

    const rect = track.getBoundingClientRect();
    const vid = videoRef.current;

    const onPointerMove = (moveEv) => {
      const clientX = moveEv.clientX;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const targetTime = ratio * duration;

      setClips((prevClips) =>
        prevClips.map((c) => {
          if (c.id !== clip.id) return c;

          if (handleType === "start") {
            const validStart = Math.max(0, Math.min(targetTime, c.endTime - 0.1));
            if (vid) vid.currentTime = validStart;
            setPlayhead(validStart);
            return { ...c, startTime: validStart };
          } else {
            const validEnd = Math.max(c.startTime + 0.1, Math.min(targetTime, duration));
            if (vid) vid.currentTime = validEnd;
            setPlayhead(validEnd);
            return { ...c, endTime: validEnd };
          }
        })
      );
    };

    const onPointerUp = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  // State Screens
  if (!recordingId) {
    return (
      <div className="editor-page">
        <div className="page-header">
          <h1>Editor</h1>
          <p>Trim, annotate and export your recordings.</p>
        </div>
        <div className="editor-no-selection">
          <span>🎞️</span>
          <h3>No Recording Selected</h3>
          <p>Please select a recording from the Library to start editing.</p>
          <button className="editor-btn-secondary" onClick={() => navigate("/library")}>
            📂 Go to Library
          </button>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="editor-page">
        <div className="page-header">
          <h1>Editor</h1>
          <p>Loading recording details...</p>
        </div>
        <div className="editor-loading">
          <div className="editor-loading-spinner" />
          <p>Fetching video data from the local database...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="editor-page">
        <div className="page-header">
          <h1>Editor</h1>
          <p>Trim, annotate and export your recordings.</p>
        </div>
        <div className="editor-error">
          <span>⚠️</span>
          <h3>Error Loading Recording</h3>
          <p>{error}</p>
          <button className="editor-btn-secondary" onClick={() => navigate("/library")}>
            📂 Back to Library
          </button>
        </div>
      </div>
    );
  }

  const selectedClip = clips.find((c) => c.id === selected);

  return (
    <div className="editor-page">
      <div className="page-header">
        <h1>Editor</h1>
        <p>{recording ? `Editing: ${recording.title}` : "Trim, annotate and export your recordings."}</p>
      </div>

      <div className="editor-layout">
        {/* ── Left: Preview + tools ── */}
        <div className="editor-main">

          {/* Preview */}
          <div className="editor-preview">
            {videoUrl ? (
              <video
                ref={videoRef}
                src={videoUrl}
                style={{ filter: videoFilterStyle }}
                preload="auto"
                onPlay={handlePlay}
                onPause={handlePause}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={(e) => {
                  const raw = e.target.duration;
                  if (isFinite(raw) && raw > 0) setDuration(raw);
                }}
                onEnded={handleVideoEnded}
              />
            ) : (
              <div className="preview-inner">
                <span className="preview-icon">🎬</span>
                <p>Preparing video player...</p>
              </div>
            )}
          </div>

          {/* Playback controls */}
          <div className="playback-bar">
            <button className="pb-btn" onClick={handleStart} title="Go to Start">⏮</button>
            <button className="pb-btn" onClick={handleBackward} title="Backward 5 seconds">⏪</button>
            <button className="pb-btn primary" onClick={togglePlay} title={isPlaying ? "Pause" : "Play"}>
              {isPlaying ? "⏸" : "▶"}
            </button>
            <button className="pb-btn" onClick={handleForward} title="Forward 5 seconds">⏩</button>
            <button className="pb-btn" onClick={handleEnd} title="Go to End">⏭</button>
            <span className="pb-time">{formatTime(playhead)} / {formatTime(duration)}</span>
            <div className="volume-control">
              <span>{volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}</span>
              <input
                type="range"
                min="0"
                max="100"
                value={Math.round(volume * 100)}
                onChange={handleVolumeChange}
              />
            </div>
          </div>

          {/* ── Timeline ── */}
          <div className="timeline-wrapper">
            <div className="timeline-header">
              <span className="tl-label">Timeline</span>
              <div className="tl-actions">
                <button
                  className="tl-btn"
                  onClick={handleSplit}
                  disabled={!canSplit}
                  title={canSplit ? "Split segment at playhead" : "Place playhead inside a segment to split"}
                >
                  ✂️ Split
                </button>
                <button
                  className="tl-btn danger"
                  onClick={handleDeleteSegment}
                  disabled={!selected}
                  title={selected ? "Delete selected segment" : "Select a segment to delete"}
                >
                  🗑️ Delete
                </button>
                <button
                  className={`tl-btn ${showColorPanel ? "active" : ""}`}
                  onClick={() => setShowColorPanel((prev) => !prev)}
                  title="Toggle Color editing panel"
                >
                  🎨 Color
                </button>
              </div>
            </div>

            {/* Color Adjustment Panel */}
            {showColorPanel && (
              <div className="color-panel">
                <div className="color-panel-header">
                  <span className="color-panel-title">🎨 Color Adjustments (Preview)</span>
                  <button
                    className="color-reset-btn"
                    onClick={() => setColorSettings(DEFAULT_COLOR_SETTINGS)}
                    title="Reset color adjustments to default"
                  >
                    🔄 Reset
                  </button>
                </div>
                <div className="color-sliders-grid">
                  <div className="color-slider-group">
                    <div className="color-slider-label">
                      <span>Brightness</span>
                      <span>{colorSettings.brightness}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={colorSettings.brightness}
                      onChange={(e) =>
                        setColorSettings((prev) => ({ ...prev, brightness: Number(e.target.value) }))
                      }
                    />
                  </div>
                  <div className="color-slider-group">
                    <div className="color-slider-label">
                      <span>Contrast</span>
                      <span>{colorSettings.contrast}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={colorSettings.contrast}
                      onChange={(e) =>
                        setColorSettings((prev) => ({ ...prev, contrast: Number(e.target.value) }))
                      }
                    />
                  </div>
                  <div className="color-slider-group">
                    <div className="color-slider-label">
                      <span>Saturation</span>
                      <span>{colorSettings.saturation}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="200"
                      value={colorSettings.saturation}
                      onChange={(e) =>
                        setColorSettings((prev) => ({ ...prev, saturation: Number(e.target.value) }))
                      }
                    />
                  </div>
                  <div className="color-slider-group">
                    <div className="color-slider-label">
                      <span>Grayscale</span>
                      <span>{colorSettings.grayscale}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={colorSettings.grayscale}
                      onChange={(e) =>
                        setColorSettings((prev) => ({ ...prev, grayscale: Number(e.target.value) }))
                      }
                    />
                  </div>
                </div>
                <div className="color-panel-footer">
                  <span className="color-notice-badge">
                    ℹ️ Preview-only: Color filters apply to the real-time player preview.
                  </span>
                </div>
              </div>
            )}

            <div className="timeline-track" onClick={handleTrackClick}>
              {/* Empty state if all segments deleted */}
              {clips.length === 0 ? (
                <div className="timeline-empty-msg">
                  <span>⚠️ All timeline segments deleted. No segments remaining.</span>
                </div>
              ) : (
                /* Clips */
                clips.map((clip) => {
                  const isSelected = selected === clip.id;
                  const leftPct = duration > 0 ? (clip.startTime / duration) * 100 : 0;
                  const widthPct =
                    duration > 0 ? ((clip.endTime - clip.startTime) / duration) * 100 : 0;

                  return (
                    <div
                      key={clip.id}
                      className={`clip ${isSelected ? "selected" : ""}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: clip.color || "#7c3aed",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelected(clip.id);
                      }}
                    >
                      {/* Trim Handles for selected clip */}
                      {isSelected && (
                        <>
                          <div
                            className="clip-handle clip-handle-left"
                            title="Drag to trim start"
                            onPointerDown={(e) => handleDragHandle(e, clip, "start")}
                          />
                          <div
                            className="clip-handle clip-handle-right"
                            title="Drag to trim end"
                            onPointerDown={(e) => handleDragHandle(e, clip, "end")}
                          />
                        </>
                      )}

                      <span className="clip-label">{clip.name}</span>
                    </div>
                  );
                })
              )}

              {/* Playhead */}
              <div
                className="playhead"
                style={{ left: `${duration > 0 ? (playhead / duration) * 100 : 0}%` }}
              >
                <div className="playhead-line" />
                <div className="playhead-head" />
              </div>
            </div>

            {/* Time ruler — dynamic marks based on actual duration */}
            <div className="time-ruler">
              {duration > 0
                ? Array.from({ length: 9 }, (_, i) => (
                    <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                      {formatTime((i / 8) * duration)}
                    </span>
                  ))
                : (
                    <>
                      <span style={{ left: "0%" }}>00:00</span>
                      <span style={{ left: "100%" }}>--:--</span>
                    </>
                  )
              }
            </div>
          </div>
        </div>

        {/* ── Right: Properties panel ── */}
        <div className="editor-panel">
          <h3 className="panel-title">Properties</h3>

          {selectedClip ? (
            <>
              <div className="prop-group">
                <label>Segment Name</label>
                <input
                  type="text"
                  value={selectedClip.name || ""}
                  onChange={(e) => {
                    const nextClips = clips.map((c) =>
                      c.id === selected ? { ...c, name: e.target.value } : c
                    );
                    setClips(nextClips);
                  }}
                />
              </div>
              <div className="prop-group">
                <label>Start Time (seconds)</label>
                <div className="trim-input-wrapper">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max={selectedClip.endTime - 0.1}
                    value={Number(selectedClip.startTime.toFixed(2))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) handleTrimStart(selectedClip.id, val);
                    }}
                  />
                  <span className="trim-time-badge">({formatTime(selectedClip.startTime)})</span>
                </div>
              </div>
              <div className="prop-group">
                <label>End Time (seconds)</label>
                <div className="trim-input-wrapper">
                  <input
                    type="number"
                    step="0.1"
                    min={selectedClip.startTime + 0.1}
                    max={duration}
                    value={Number(selectedClip.endTime.toFixed(2))}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) handleTrimEnd(selectedClip.id, val);
                    }}
                  />
                  <span className="trim-time-badge">({formatTime(selectedClip.endTime)})</span>
                </div>
              </div>
              <div className="prop-group">
                <label>Duration</label>
                <input
                  type="text"
                  readOnly
                  value={`${(selectedClip.endTime - selectedClip.startTime).toFixed(2)}s (${formatTime(selectedClip.endTime - selectedClip.startTime)})`}
                />
              </div>
              <div className="prop-group">
                <label>Speed</label>
                <select value={playbackSpeed} onChange={handlePlaybackSpeedChange}>
                  <option value="0.5x">0.5x</option>
                  <option value="1x">1x</option>
                  <option value="1.5x">1.5x</option>
                  <option value="2x">2x</option>
                </select>
              </div>
            </>
          ) : (
            <div className="panel-placeholder">
              <span>🎞️</span>
              <p>Select a segment in the timeline to view and edit its properties.</p>
            </div>
          )}

          <div className="export-section">
            <h3 className="panel-title">Export</h3>
            <div className="prop-group">
              <label>Format</label>
              <select value="webm" disabled title="Browser MediaRecorder only supports WebM output">
                <option value="webm">WebM (VP9/VP8 + Opus) ✓</option>
                <option value="mp4" disabled>MP4 — not supported in browser</option>
              </select>
            </div>
            <div className="prop-group">
              <label>Resolution</label>
              <select
                value={exportResolution}
                onChange={(e) => setExportResolution(e.target.value)}
                disabled={isExporting}
              >
                <option value="720">720p (1280×720)</option>
                <option value="1080">1080p (1920×1080)</option>
                <option value="4k">4K (3840×2160)</option>
              </select>
            </div>

            {/* Export progress bar */}
            {isExporting && (
              <div className="export-progress-wrapper">
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{ width: `${exportProgress}%` }}
                  />
                </div>
                <span className="export-progress-label">
                  {exportProgress < 100 ? `Exporting… ${exportProgress}%` : "Finalising…"}
                </span>
              </div>
            )}

            {exportError && (
              <div className="export-error-msg">{exportError}</div>
            )}

            {/* Segments info */}
            {!isExporting && clips.length > 0 && (
              <div className="export-info">
                {clips.length} segment{clips.length !== 1 ? "s" : ""} ·{" "}
                {clips.reduce((s, c) => s + (c.endTime - c.startTime), 0).toFixed(1)}s total
              </div>
            )}

            <button
              className="export-btn"
              disabled={isExporting || clips.length === 0 || !videoUrl}
              onClick={async () => {
                if (isExporting) return;
                setIsExporting(true);
                setExportProgress(0);
                setExportError(null);
                exportCancelRef.current = { cancelled: false };
                try {
                  const { blob, mimeType } = await exportVideo({
                    sourceUrl: videoUrl,
                    segments: clips,
                    colorSettings,
                    resolution: exportResolution,
                    onProgress: setExportProgress,
                    cancelRef: exportCancelRef.current,
                  });
                  const ext = mimeType.includes("webm") ? "webm" : "webm";
                  const filename = `${(recording?.title || "export").replace(/[^a-z0-9_-]/gi, "_")}_edited.${ext}`;
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  setTimeout(() => URL.revokeObjectURL(url), 10000);
                } catch (err) {
                  if (!exportCancelRef.current.cancelled) {
                    console.error("[Export] Failed:", err);
                    setExportError(err.message || "Export failed.");
                  }
                } finally {
                  setIsExporting(false);
                }
              }}
              style={clips.length === 0 ? { opacity: 0.4, cursor: "not-allowed" } : {}}
            >
              {isExporting ? "⏳ Exporting…" : "⬇ Export Video (.webm)"}
            </button>

            {isExporting && (
              <button
                className="export-cancel-btn"
                onClick={() => { exportCancelRef.current.cancelled = true; }}
              >
                ✕ Cancel Export
              </button>
            )}

            <div className="export-notice">
              ℹ️ Export re-encodes the video using Canvas + MediaRecorder. Applies trim, split, deletes, and color filters. Duration matches your edited segments. The original recording is not affected.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Editor;
