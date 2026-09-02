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
  const [selectedSegmentId, setSelectedSegmentId] = useState(null);
  const [clips, setClips] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState("1x");

  // Color Panel toggle
  const [showColorPanel, setShowColorPanel] = useState(false);

  // Export State (Stage 5)
  const [exportResolution, setExportResolution] = useState("1080");
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportError, setExportError] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(null); // filename string on success
  const exportCancelRef = useRef({ cancelled: false });

  const videoRef = useRef(null);
  const rafRef = useRef(null);
  const hasInitializedClips = useRef(false);

  const getActiveSegments = useCallback(() => {
    return [...clips].sort((a, b) => a.startTime - b.startTime);
  }, [clips]);

  const getEditedDuration = useCallback(() => {
    return getActiveSegments().reduce((acc, c) => acc + (c.endTime - c.startTime), 0);
  }, [getActiveSegments]);

  const originalTimeToEditedTime = useCallback((origTime) => {
    const active = getActiveSegments();
    let edited = 0;
    for (const c of active) {
      if (origTime >= c.startTime && origTime <= c.endTime) {
        return edited + (origTime - c.startTime);
      }
      if (origTime > c.endTime) {
        edited += (c.endTime - c.startTime);
      } else {
        return edited;
      }
    }
    return edited;
  }, [getActiveSegments]);

  const editedTimeToOriginalTime = useCallback((editedTime) => {
    const active = getActiveSegments();
    let currentEdited = 0;
    for (const c of active) {
      const dur = c.endTime - c.startTime;
      if (editedTime >= currentEdited && editedTime <= currentEdited + dur) {
        return c.startTime + (editedTime - currentEdited);
      }
      currentEdited += dur;
    }
    if (active.length > 0) return active[active.length - 1].endTime;
    return 0;
  }, [getActiveSegments]);

  const findActiveSegmentAtEditedTime = useCallback((editedTime) => {
    const active = getActiveSegments();
    let currentEdited = 0;
    for (const c of active) {
      const dur = c.endTime - c.startTime;
      if (editedTime >= currentEdited && editedTime <= currentEdited + dur) {
        return c;
      }
      currentEdited += dur;
    }
    return null;
  }, [getActiveSegments]);

  // Derivations for active clip and video preview filter
  const selectedClip = clips.find((c) => c.id === selectedSegmentId);
  const activeClip = findActiveSegmentAtEditedTime(playhead) || selectedClip;
  const activeColors = activeClip?.colorSettings || DEFAULT_COLOR_SETTINGS;
  const videoFilterStyle = `brightness(${activeColors.brightness}%) contrast(${activeColors.contrast}%) saturate(${activeColors.saturation}%) grayscale(${activeColors.grayscale}%)`;

  // 1. Fetch recording details from IndexedDB
  useEffect(() => {
    if (!recordingId) {
      Promise.resolve().then(() => setIsLoading(false));
      return;
    }

    let active = true;
    // Avoid synchronous setState inside effect body
    Promise.resolve().then(() => { setIsLoading(true); setError(null); });

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
        id: `seg_${Date.now()}`,
        name: "Segment 1",
        startTime: 0,
        endTime: duration,
        color: "#7c3aed",
        colorSettings: { ...DEFAULT_COLOR_SETTINGS },
      };
      setClips([initialSeg]);
      setSelectedSegmentId(initialSeg.id);
    }
  }, [duration, clips.length]);

  const formatTime = (s) => {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60).toString().padStart(2, "0");
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  const parseDurationStr = (durStr) => {
    if (!durStr) return 0;
    const parts = durStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
  };

  // Playback Control Handlers
  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;

    if (vid.paused) {
      const active = getActiveSegments();
      if (active.length === 0) return;

      const editedDur = getEditedDuration();
      if (playhead >= editedDur) {
        return;
      }

      const currentOrigTime = vid.currentTime;
      let inActiveSeg = active.some(c => currentOrigTime >= c.startTime && currentOrigTime < c.endTime);

      if (!inActiveSeg) {
        const nextSeg = active.find(c => c.startTime > currentOrigTime) || active[0];
        vid.currentTime = nextSeg.startTime;
      }

      vid.play().catch((err) => console.error("Playback failed:", err));
    } else {
      vid.pause();
    }
  };

  const handleBackward = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.max(0, vid.currentTime - 5);
    setPlayhead(originalTimeToEditedTime(vid.currentTime));
  };

  const handleForward = () => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.currentTime = Math.min(duration, vid.currentTime + 5);
    setPlayhead(originalTimeToEditedTime(vid.currentTime));
  };

  const handleStart = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const active = getActiveSegments();
    if (active.length > 0) {
      vid.currentTime = active[0].startTime;
    } else {
      vid.currentTime = 0;
    }
    setPlayhead(0);
  };

  const handleEnd = () => {
    const vid = videoRef.current;
    if (!vid) return;
    const active = getActiveSegments();
    if (active.length > 0) {
      vid.currentTime = active[active.length - 1].endTime;
      setPlayhead(getEditedDuration());
    } else {
      vid.currentTime = duration;
      setPlayhead(0);
    }
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
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));

    const editedDur = getEditedDuration();
    const targetEditedTime = ratio * editedDur;
    const targetOrigTime = editedTimeToOriginalTime(targetEditedTime);

    vid.currentTime = targetOrigTime;
    setPlayhead(targetEditedTime);
  };

  const handleTrackPointerDown = (e) => {
    console.log('[TRACK] handleTrackPointerDown fired, target:', e.target.className);
    const track = e.currentTarget;
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const editedDur = getEditedDuration();
    const targetEditedTime = ratio * editedDur;
    const targetOrigTime = editedTimeToOriginalTime(targetEditedTime);
    if (videoRef.current && duration) {
      videoRef.current.currentTime = targetOrigTime;
      setPlayhead(targetEditedTime);
    }
  };

  const handlePlayheadPointerDown = (e) => {
    e.stopPropagation();
    const track = e.currentTarget.closest('.timeline-track');
    if (!track) return;
    const editedDur = getEditedDuration();
    if (!editedDur) return;
    stopRaf();
    if (videoRef.current) videoRef.current.pause();
    const rect = track.getBoundingClientRect();
    const onMove = (moveEv) => {
      const ratio = Math.max(0, Math.min(1, (moveEv.clientX - rect.left) / rect.width));
      const targetEditedTime = ratio * editedDur;
      const targetOrigTime = editedTimeToOriginalTime(targetEditedTime);
      if (videoRef.current) videoRef.current.currentTime = targetOrigTime;
      setPlayhead(targetEditedTime);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const startRaf = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const loop = () => {
      if (videoRef.current) {
        const vid = videoRef.current;
        const origTime = vid.currentTime;
        const active = getActiveSegments();

        if (active.length === 0) {
          setPlayhead(0);
          vid.pause();
          setIsPlaying(false);
        } else {
          const activeSeg = active.find(c => origTime >= c.startTime && origTime < c.endTime);
          if (activeSeg) {
            setPlayhead(originalTimeToEditedTime(origTime));
          } else {
            const lastSeg = active[active.length - 1];
            if (origTime >= lastSeg.endTime) {
              vid.pause();
              setIsPlaying(false);
              setPlayhead(getEditedDuration());
            } else {
              const nextSeg = active.find(c => origTime < c.startTime);
              if (nextSeg) {
                vid.currentTime = nextSeg.startTime;
                setPlayhead(originalTimeToEditedTime(nextSeg.startTime));
              } else {
                vid.pause();
                setIsPlaying(false);
                setPlayhead(getEditedDuration());
              }
            }
          }
        }
      }

      if (videoRef.current && !videoRef.current.paused) {
        rafRef.current = requestAnimationFrame(loop);
      }
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [getActiveSegments, originalTimeToEditedTime, getEditedDuration]);

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
      setPlayhead(originalTimeToEditedTime(videoRef.current.currentTime));
    }
  };
  const handleTimeUpdate = () => {
    if (videoRef.current && !rafRef.current) {
      setPlayhead(originalTimeToEditedTime(videoRef.current.currentTime));
    }
  };
  const handleVideoEnded = () => {
    setIsPlaying(false);
    stopRaf();
    if (videoRef.current) {
      setPlayhead(getEditedDuration());
    }
  };
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    if (vid) {
      const raw = vid.duration;
      let vidDuration = isFinite(raw) && raw > 0 ? raw : 0;
      if (vidDuration === 0 && recording && recording.duration) {
        vidDuration = parseDurationStr(recording.duration);
      }
      setDuration(vidDuration);
      setPlayhead(originalTimeToEditedTime(vid.currentTime));
      if (!hasInitializedClips.current && vidDuration > 0) {
        hasInitializedClips.current = true;
        const initialSeg = {
          id: `seg_${Date.now()}`,
          name: "Segment 1",
          startTime: 0,
          endTime: vidDuration,
          color: "#7c3aed",
          colorSettings: { ...DEFAULT_COLOR_SETTINGS },
        };
        setClips([initialSeg]);
        setSelectedSegmentId(initialSeg.id);
      }
    }
  };

  // ── STAGE 3 EDITING ACTIONS: SPLIT, DELETE, TRIM ──

  // Check if playhead is inside any segment with at least 0.2s clearance from edges
  const activeClipForSplit = findActiveSegmentAtEditedTime(playhead);
  // Use the derived edited playhead time for render-time checks (avoid reading refs during render)
  const origSplitTime = editedTimeToOriginalTime(playhead);
  const canSplit = activeClipForSplit &&
    (origSplitTime > activeClipForSplit.startTime + 0.2) &&
    (origSplitTime < activeClipForSplit.endTime - 0.2);

  // SPLIT
  const handleSplit = () => {
    const vid = videoRef.current;
    const splitTime = vid ? vid.currentTime : editedTimeToOriginalTime(playhead);

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

    const timeStamp = Date.now();
    const id1 = `seg_${timeStamp}_a_${Math.floor(Math.random() * 1000)}`;
    const id2 = `seg_${timeStamp}_b_${Math.floor(Math.random() * 1000)}`;

    const seg1 = {
      ...targetSeg,
      id: id1,
      endTime: splitTime,
      colorSettings: { ...(targetSeg.colorSettings || DEFAULT_COLOR_SETTINGS) },
    };

    const seg2 = {
      ...targetSeg,
      id: id2,
      name: `Segment ${clips.length + 1}`,
      startTime: splitTime,
      endTime: targetSeg.endTime,
      colorSettings: { ...(targetSeg.colorSettings || DEFAULT_COLOR_SETTINGS) },
    };

    const updated = clips.flatMap((c) =>
      c.id === targetSeg.id ? [seg1, seg2] : [c]
    );
    updated.sort((a, b) => a.startTime - b.startTime);

    setClips(updated);
    setSelectedSegmentId(seg2.id);
    if (videoRef.current) {
      setPlayhead(originalTimeToEditedTime(videoRef.current.currentTime));
    }
  };

  // DELETE
  const handleDeleteSegment = () => {
    console.log('[DELETE] handleDeleteSegment called');
    console.log('[DELETE] selectedSegmentId:', selectedSegmentId);
    if (!selectedSegmentId) { console.log('[DELETE] EARLY EXIT: no selectedSegmentId'); return; }
    const targetSeg = clips.find(c => c.id === selectedSegmentId);
    if (!targetSeg) { console.log('[DELETE] EARLY EXIT: targetSeg not found'); return; }
    const confirmDelete = window.confirm(`Are you sure you want to delete "${targetSeg.name}"?`);
    if (!confirmDelete) return;
    setClips(prevClips => {
      const updated = prevClips.filter(c => c.id !== selectedSegmentId);
      console.log('[DELETE] updated clips after filter:', updated.map(c => ({ id: c.id, name: c.name })));
      // After deletion, clear selection or select first remaining segment
      if (updated.length > 0) {
        setSelectedSegmentId(updated[0].id);
      } else {
        setSelectedSegmentId(null);
      }
      return updated;
    });
  };

  // COLOR HANDLERS (PER SEGMENT)
  const selectedColorSettings = selectedClip?.colorSettings || DEFAULT_COLOR_SETTINGS;

  const handleColorChange = (key, value) => {
    if (!selectedSegmentId) return;
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === selectedSegmentId) {
          return {
            ...c,
            colorSettings: {
              ...(c.colorSettings || DEFAULT_COLOR_SETTINGS),
              [key]: value,
            },
          };
        }
        return c;
      })
    );
  };

  const handleResetColor = () => {
    if (!selectedSegmentId) return;
    setClips((prevClips) =>
      prevClips.map((c) => {
        if (c.id === selectedSegmentId) {
          return {
            ...c,
            colorSettings: { ...DEFAULT_COLOR_SETTINGS },
          };
        }
        return c;
      })
    );
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
      setPlayhead(originalTimeToEditedTime(safeStart));
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
      setPlayhead(originalTimeToEditedTime(safeEnd));
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

    const initialClientX = e.clientX;
    const initialStartTime = clip.startTime;
    const initialEndTime = clip.endTime;
    const initialEditedDuration = getEditedDuration();

    const onPointerMove = (moveEv) => {
      const deltaX = moveEv.clientX - initialClientX;
      const deltaEditedTime = initialEditedDuration > 0 ? (deltaX / rect.width) * initialEditedDuration : 0;

      setClips((prevClips) =>
        prevClips.map((c) => {
          if (c.id !== clip.id) return c;

          if (handleType === "start") {
            const validStart = Math.max(0, Math.min(initialStartTime + deltaEditedTime, c.endTime - 0.1));
            if (vid) vid.currentTime = validStart;
            setPlayhead(originalTimeToEditedTime(validStart));
            return { ...c, startTime: validStart };
          } else {
            const validEnd = Math.max(c.startTime + 0.1, Math.min(initialEndTime + deltaEditedTime, duration));
            if (vid) vid.currentTime = validEnd;
            setPlayhead(originalTimeToEditedTime(validEnd));
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
                  let vidDuration = isFinite(raw) && raw > 0 ? raw : 0;
                  if (vidDuration === 0 && recording && recording.duration) {
                    vidDuration = parseDurationStr(recording.duration);
                  }
                  if (vidDuration > 0) setDuration(vidDuration);
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
            <span className="pb-time">{formatTime(playhead)} / {formatTime(getEditedDuration())}</span>
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
                  disabled={!selectedSegmentId}
                  title={selectedSegmentId ? "Delete selected segment" : "Select a segment to delete"}
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
                  <span className="color-panel-title">
                    🎨 Color Adjustments ({selectedClip ? selectedClip.name : "No Segment Selected"})
                  </span>
                  {selectedClip && (
                    <button
                      className="color-reset-btn"
                      onClick={handleResetColor}
                      title="Reset color adjustments to default"
                    >
                      🔄 Reset
                    </button>
                  )}
                </div>

                {!selectedClip ? (
                  <div className="color-notice-badge" style={{ padding: "0.5rem 0" }}>
                    ⚠️ Please select a segment on the timeline to adjust its color settings.
                  </div>
                ) : (
                  <>
                    <div className="color-sliders-grid">
                      <div className="color-slider-group">
                        <div className="color-slider-label">
                          <span>Brightness</span>
                          <span>{selectedColorSettings.brightness}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={selectedColorSettings.brightness}
                          onChange={(e) => handleColorChange("brightness", Number(e.target.value))}
                        />
                      </div>
                      <div className="color-slider-group">
                        <div className="color-slider-label">
                          <span>Contrast</span>
                          <span>{selectedColorSettings.contrast}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={selectedColorSettings.contrast}
                          onChange={(e) => handleColorChange("contrast", Number(e.target.value))}
                        />
                      </div>
                      <div className="color-slider-group">
                        <div className="color-slider-label">
                          <span>Saturation</span>
                          <span>{selectedColorSettings.saturation}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={selectedColorSettings.saturation}
                          onChange={(e) => handleColorChange("saturation", Number(e.target.value))}
                        />
                      </div>
                      <div className="color-slider-group">
                        <div className="color-slider-label">
                          <span>Grayscale</span>
                          <span>{selectedColorSettings.grayscale}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={selectedColorSettings.grayscale}
                          onChange={(e) => handleColorChange("grayscale", Number(e.target.value))}
                        />
                      </div>
                    </div>
                    <div className="color-panel-footer">
                      <span className="color-notice-badge">
                        ✅ Color filters apply independently to {selectedClip.name}.
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="timeline-track" onClick={handleTrackClick} onPointerDown={handleTrackPointerDown}>
              {/* Empty state if all segments deleted */}
              {clips.length === 0 ? (
                <div className="timeline-empty-msg">
                  <span>⚠️ All timeline segments deleted. No segments remaining.</span>
                </div>
              ) : (
                /* Clips */
                getActiveSegments().map((clip) => {
                  const isSelected = selectedSegmentId === clip.id;

                  const active = getActiveSegments();
                  let startEdited = 0;
                  for (const c of active) {
                    if (c.id === clip.id) break;
                    startEdited += c.endTime - c.startTime;
                  }

                  const editedDur = getEditedDuration();
                  const clipDur = clip.endTime - clip.startTime;

                  const leftPct = editedDur > 0 ? (startEdited / editedDur) * 100 : 0;
                  const widthPct = editedDur > 0 ? (clipDur / editedDur) * 100 : 0;

                  return (
                    <div
                      key={clip.id}
                      className={`clip ${isSelected ? "selected" : ""}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: clip.color || "#7c3aed",
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        console.log('[SELECT] onPointerDown clip:', clip.id, clip.name);
                        setSelectedSegmentId(clip.id);
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        console.log('[SELECT] onClick clip:', clip.id, clip.name);
                        setSelectedSegmentId(clip.id);
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
                style={{ left: `${getEditedDuration() > 0 ? (playhead / getEditedDuration()) * 100 : 0}%` }}
                onPointerDown={handlePlayheadPointerDown}
              >
                <div className="playhead-line" />
                <div className="playhead-head" />
              </div>
            </div>

            {/* Time ruler — dynamic marks based on actual duration */}
            <div className="time-ruler">
              {getEditedDuration() > 0
                ? Array.from({ length: 9 }, (_, i) => (
                  <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                    {formatTime((i / 8) * getEditedDuration())}
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
                      c.id === selectedSegmentId ? { ...c, name: e.target.value } : c
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
                // Pause the preview video so it doesn't compete with the export audio routing
                if (videoRef.current && !videoRef.current.paused) {
                  videoRef.current.pause();
                }
                setIsExporting(true);
                setExportProgress(0);
                setExportError(null);
                setExportSuccess(null);
                // Create a fresh cancel ref for this export run
                const cancelToken = { cancelled: false };
                exportCancelRef.current = cancelToken;
                try {
                  const { blob } = await exportVideo({
                    sourceUrl: videoUrl,
                    segments: clips,
                    colorSettings: DEFAULT_COLOR_SETTINGS,
                    resolution: exportResolution,
                    onProgress: setExportProgress,
                    cancelRef: cancelToken,
                  });
                  const ext = "webm";
                  const baseName = (recording?.title || "export").replace(/[^a-z0-9_-]/gi, "_");
                  const filename = `${baseName}_edited.${ext}`;
                  // Trigger download
                  const dlUrl = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = dlUrl;
                  a.download = filename;
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  // Keep the URL alive for 15s so the browser can serve it, then revoke
                  setTimeout(() => URL.revokeObjectURL(dlUrl), 15000);
                  setExportSuccess(filename);
                } catch (err) {
                  if (!cancelToken.cancelled) {
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

            {exportSuccess && !isExporting && (
              <div className="export-success-msg">
                ✅ Saved: <strong>{exportSuccess}</strong>
              </div>
            )}

            <div className="export-notice">
              ℹ️ Re-encodes via Canvas + MediaRecorder (WebM/VP9). Applies split, trim, deletes &amp; color filters. Original recording is never modified.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Editor;
