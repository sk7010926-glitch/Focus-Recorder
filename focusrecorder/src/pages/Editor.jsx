import { useState, useEffect, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { getRecording } from "../services/db";
import "./Editor.css";

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
  const [duration, setDuration] = useState(0.1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [volume, setVolume] = useState(0.8);
  const [selected, setSelected] = useState(null);
  const [clips, setClips] = useState([]);
  const [playbackSpeed, setPlaybackSpeed] = useState("1x");

  const videoRef = useRef(null);

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

  // Video Event Handlers
  const handlePlay = () => setIsPlaying(true);
  const handlePause = () => setIsPlaying(false);
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setPlayhead(videoRef.current.currentTime);
    }
  };
  const handleLoadedMetadata = () => {
    const vid = videoRef.current;
    if (vid) {
      const vidDuration = vid.duration || 0.1;
      setDuration(vidDuration);
      setPlayhead(vid.currentTime);
      setClips([
        { id: 1, label: recording?.title || "Main Take", start: 0, end: vidDuration, color: "#7c3aed" }
      ]);
    }
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
                preload="auto"
                onPlay={handlePlay}
                onPause={handlePause}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={(e) => setDuration(e.target.duration || 0.1)}
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
                <button className="tl-btn" disabled>✂️ Split</button>
                <button className="tl-btn" disabled>🗑️ Delete</button>
                <button className="tl-btn" disabled>🎨 Color</button>
              </div>
            </div>

            <div className="timeline-track" onClick={handleTrackClick}>
              {/* Clips */}
              {clips.map((clip) => (
                <div
                  key={clip.id}
                  className={`clip ${selected === clip.id ? "selected" : ""}`}
                  style={{
                    left: `${(clip.start / duration) * 100}%`,
                    width: `${((clip.end - clip.start) / duration) * 100}%`,
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
                style={{ left: `${(playhead / duration) * 100}%` }}
              >
                <div className="playhead-line" />
                <div className="playhead-head" />
              </div>
            </div>

            {/* Time ruler */}
            <div className="time-ruler">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} style={{ left: `${(i / 8) * 100}%` }}>
                  {formatTime((i / 8) * duration)}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right: Properties panel ── */}
        <div className="editor-panel">
          <h3 className="panel-title">Properties</h3>

          {selectedClip ? (
            <>
              <div className="prop-group">
                <label>Clip Name</label>
                <input
                  type="text"
                  value={selectedClip.label}
                  onChange={(e) => {
                    const nextClips = clips.map((c) =>
                      c.id === selected ? { ...c, label: e.target.value } : c
                    );
                    setClips(nextClips);
                  }}
                />
              </div>
              <div className="prop-group">
                <label>Start Time</label>
                <input
                  type="text"
                  readOnly
                  value={formatTime(selectedClip.start)}
                />
              </div>
              <div className="prop-group">
                <label>End Time</label>
                <input
                  type="text"
                  readOnly
                  value={formatTime(selectedClip.end)}
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
              <p>Click the video track block in the timeline to view its properties.</p>
            </div>
          )}

          <div className="export-section">
            <h3 className="panel-title">Export</h3>
            <div className="prop-group">
              <label>Format</label>
              <select defaultValue="mp4" disabled>
                <option value="mp4">MP4 (H.264)</option>
                <option value="webm">WebM (VP9)</option>
                <option value="mov">MOV (ProRes)</option>
              </select>
            </div>
            <div className="prop-group">
              <label>Resolution</label>
              <select defaultValue="1080" disabled>
                <option value="720">720p</option>
                <option value="1080">1080p</option>
                <option value="4k">4K</option>
              </select>
            </div>
            <button className="export-btn" style={{ opacity: 0.5, cursor: "not-allowed" }} disabled>⬇ Export Video</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Editor;
