import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { getAllRecordings, deleteRecording, updateRecording } from "../services/db";
import "./Library.css";

const TAGS = ["All", "Demo", "Meeting", "Tutorial", "Debug", "Review", "Screen"];

// ── Thumbnail: stable object URL per blob ──────────────────────────────────
// We create ONE URL per recording and revoke it when the component unmounts
// or when the recordings list changes.
function useBlobUrls(recordings) {
  const [urls, setUrls] = useState({});

  useEffect(() => {
    const nextUrls = {};
    recordings.forEach((rec) => {
      if (rec.blob) {
        nextUrls[rec.id] = URL.createObjectURL(rec.blob);
      }
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUrls(nextUrls);

    return () => {
      Object.values(nextUrls).forEach((url) => {
        URL.revokeObjectURL(url);
      });
    };
  }, [recordings]);

  return urls;
}

// ── Play Modal ─────────────────────────────────────────────────────────────
// Parses "HH:MM:SS" or "MM:SS" duration strings saved by the recorder timer.
function parseRecDuration(durStr) {
  if (!durStr) return 0;
  const parts = durStr.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function PlayModal({ rec, url, onClose }) {
  const videoRef       = useRef(null);
  const progressBarRef = useRef(null);   // the track div
  const fillRef        = useRef(null);   // the colored fill div
  const thumbRef       = useRef(null);   // the thumb dot
  const rafRef         = useRef(null);   // requestAnimationFrame id
  const isDraggingRef  = useRef(false);
  // Tracks whether the video has reached the ended state.
  // While true, the RAF loop skips writing to the bar so it stays frozen at 100%.
  // Cleared when the user seeks or explicitly presses Play after ended.
  const isEndedRef     = useRef(false);
  // Stores the resolved duration in seconds — updated from video.duration on loadedmetadata
  const durationRef    = useRef(parseRecDuration(rec.duration));

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);  // only for the time label
  // Duration label state — initialized from stored string, updated once video metadata loads
  const [duration, setDuration] = useState(() => parseRecDuration(rec.duration));

  // Keep durationRef in sync with state so RAF / seek closures always see latest value
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // ── RAF loop: update fill width directly on the DOM, no React re-renders ──
  // Always reads vid.currentTime and vid.duration live — video element is sole source of truth.
  useEffect(() => {
    const vid  = videoRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!vid || !fill || !thumb) return;

    let lastLabelUpdate = 0;

    function tick() {
      rafRef.current = requestAnimationFrame(tick);
      // While dragging, seekFromEvent handles DOM updates synchronously — skip RAF writes.
      if (isDraggingRef.current) return;
      // While ended, the bar is frozen at 100% by the onEnded handler — skip RAF writes
      // so a browser-internal currentTime reset (Chrome resets to 0 on some codecs) can't
      // overwrite the 100% position before the user interacts again.
      if (isEndedRef.current) return;

      // Prefer the live video element duration; fall back to stored value
      const effectiveDuration = (isFinite(vid.duration) && vid.duration > 0)
        ? vid.duration
        : durationRef.current;
      if (!effectiveDuration) return;

      const ct  = vid.currentTime;
      const pct = Math.min(100, Math.max(0, (ct / effectiveDuration) * 100));

      // Update bar width directly — zero React overhead, always in sync with video
      fill.style.width  = pct + "%";
      thumb.style.left  = pct + "%";

      // Update the time label at most 4 times per second to avoid layout thrash
      const now = performance.now();
      if (now - lastLabelUpdate > 250) {
        lastLabelUpdate = now;
        setCurrentTime(ct);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []); // run once on mount — reads vid state live each frame

  // ── Keyboard close ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Play/pause toggle ────────────────────────────────────────────────────
  const togglePlay = () => {
    const vid = videoRef.current;
    if (!vid) return;
    if (vid.paused || vid.ended) {
      // If the user presses Play after the video has ended, intentionally restart from 0.
      // This is the ONLY place we reset the playhead to 0.
      if (isEndedRef.current) {
        isEndedRef.current = false;
        vid.currentTime = 0;
        if (fillRef.current)  fillRef.current.style.width = "0%";
        if (thumbRef.current) thumbRef.current.style.left  = "0%";
        setCurrentTime(0);
      }
      vid.play();
      setIsPlaying(true);
    } else {
      vid.pause();
      setIsPlaying(false);
    }
  };

  // ── Seek: compute time from pointer position and set video.currentTime ───
  const seekFromEvent = (e) => {
    const bar = progressBarRef.current;
    const vid = videoRef.current;
    const fill = fillRef.current;
    const thumb = thumbRef.current;
    if (!bar || !vid) return;
    // Use the live video duration when available — more accurate than stored value
    const effectiveDuration = (isFinite(vid.duration) && vid.duration > 0)
      ? vid.duration
      : durationRef.current;
    if (!effectiveDuration) return;
    const rect   = bar.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const ratio  = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * effectiveDuration;
    vid.currentTime = newTime;
    setCurrentTime(newTime);
    // Immediately update DOM so the bar doesn't lag during drag
    const pct = ratio * 100;
    if (fill)  fill.style.width = pct + "%";
    if (thumb) thumb.style.left = pct + "%";
  };

  const handleBarPointerDown = (e) => {
    e.preventDefault();
    // Seeking clears the ended state so the RAF resumes tracking from the new position.
    isEndedRef.current = false;
    isDraggingRef.current = true;
    seekFromEvent(e);
    const onMove = (ev) => { if (isDraggingRef.current) seekFromEvent(ev); };
    const onUp   = (ev) => {
      isDraggingRef.current = false;
      seekFromEvent(ev);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup",   onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup",   onUp);
  };

  const fmt = (s) => {
    const safe = isFinite(s) && s >= 0 ? s : 0;
    const m   = Math.floor(safe / 60).toString().padStart(2, "0");
    const sec = Math.floor(safe % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  return (
    <div className="play-modal-backdrop" onClick={onClose}>
      <div className="play-modal" onClick={(e) => e.stopPropagation()}>
        <div className="play-modal-header">
          <span className="play-modal-title">{rec.title}</span>
          <button className="play-modal-close" onClick={onClose}>✕</button>
        </div>
        <video
          ref={videoRef}
          className="play-modal-video"
          src={url}
          autoPlay
          onPlay={() => {
            // Clear the ended flag whenever playback (re)starts — RAF resumes tracking.
            isEndedRef.current = false;
            setIsPlaying(true);
          }}
          onPause={() => setIsPlaying(false)}
          onLoadedMetadata={() => {
            const vid = videoRef.current;
            if (vid && isFinite(vid.duration) && vid.duration > 0) {
              // Use the actual decoded video duration — overrides the stored string value.
              // Do NOT reset currentTime here: loadedmetadata fires again after seeks and
              // after ended, so calling setCurrentTime(0) would reset the label on every seek.
              setDuration(vid.duration);
              // Only update the label if the video hasn't started yet (currentTime is 0)
              // so we don't overwrite a valid seek position with 0.
              if (vid.currentTime === 0) setCurrentTime(0);
            }
          }}
          onEnded={() => {
            // Mark as ended FIRST so the RAF loop stops overwriting the bar position.
            isEndedRef.current = true;
            setIsPlaying(false);
            // Snap bar to 100% and set label to the real final time.
            if (fillRef.current)  fillRef.current.style.width  = "100%";
            if (thumbRef.current) thumbRef.current.style.left  = "100%";
            const vid = videoRef.current;
            const endTime = (vid && isFinite(vid.duration) && vid.duration > 0)
              ? vid.duration
              : durationRef.current;
            setCurrentTime(endTime);
          }}
        />
        {/* ── Seek bar ── */}
        <div className="play-modal-controls">
          <button className="play-modal-playbtn" onClick={togglePlay}>
            {isPlaying ? "⏸" : "▶"}
          </button>
          <span className="play-modal-timetext">{fmt(currentTime)}</span>
          <div
            ref={progressBarRef}
            className="play-modal-progress"
            onPointerDown={handleBarPointerDown}
          >
            <div ref={fillRef}  className="play-modal-progress-fill"  style={{ width: "0%" }} />
            <div ref={thumbRef} className="play-modal-progress-thumb" style={{ left:  "0%" }} />
          </div>
          <span className="play-modal-timetext">{fmt(duration)}</span>
        </div>
        <div className="play-modal-meta">
          <span>⏱ {rec.duration}</span>
          <span>📅 {rec.date}</span>
          <span>💾 {rec.size}</span>
        </div>
      </div>
    </div>
  );
}

// ── Rename Input ───────────────────────────────────────────────────────────
function RenameInput({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed && trimmed !== initial) onSave(trimmed);
    else onCancel();
  };

  return (
    <input
      ref={inputRef}
      className="rename-input"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
        if (e.key === "Escape") onCancel();
      }}
      onBlur={commit}
      maxLength={120}
    />
  );
}

// ── Library Page ───────────────────────────────────────────────────────────
function Library() {
  const [recordings, setRecordings] = useState([]);
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const [playRec, setPlayRec] = useState(null);  // rec being played in modal
  const [renamingId, setRenamingId] = useState(null);  // id being renamed
  const [loadError, setLoadError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Only load if recordings are empty (initial mount) to avoid 
    // constant re-fetching / setState loops in strict mode
    let mounted = true;
    getAllRecordings()
      .then((recs) => {
        if (mounted) {
          setRecordings(recs);
          setLoadError(null);
        }
      })
      .catch((err) => {
        console.error("Failed to load recordings:", err);
        if (mounted) setLoadError("Could not load recordings from the database.");
      });

    return () => { mounted = false; };
  }, []);

  // Stable object URLs — one per blob, revoked on unmount / list change
  const blobUrls = useBlobUrls(recordings);

  // ── Filtered list ────────────────────────────────────────────────────────
  const filtered = useMemo(() => recordings.filter((r) => {
    const matchTag = filter === "All" || r.tag === filter;
    const matchSearch = r.title.toLowerCase().includes(search.toLowerCase());
    return matchTag && matchSearch;
  }), [recordings, filter, search]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handlePlay = useCallback((rec) => {
    if (blobUrls[rec.id]) setPlayRec(rec);
  }, [blobUrls]);

  const handleDownload = useCallback((rec) => {
    const url = blobUrls[rec.id];
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = `${rec.title}.webm`;
    a.click();
  }, [blobUrls]);

  const handleDelete = useCallback(async (id) => {
    if (!window.confirm("Delete this recording? This cannot be undone.")) return;
    try {
      await deleteRecording(id);
      // Also close the modal if the deleted recording was being played
      setPlayRec((prev) => (prev?.id === id ? null : prev));
      setRecordings((prev) => prev.filter((r) => r.id !== id));
    } catch (err) {
      console.error("Failed to delete recording:", err);
    }
  }, []);

  const handleRename = useCallback(async (id, newTitle) => {
    try {
      await updateRecording(id, { title: newTitle });
      setRecordings((prev) =>
        prev.map((r) => (r.id === id ? { ...r, title: newTitle } : r))
      );
    } catch (err) {
      console.error("Failed to rename recording:", err);
    } finally {
      setRenamingId(null);
    }
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="library-page">
      {/* Play Modal */}
      {playRec && blobUrls[playRec.id] && (
        <PlayModal
          rec={playRec}
          url={blobUrls[playRec.id]}
          onClose={() => setPlayRec(null)}
        />
      )}

      {/* Header */}
      <div className="page-header">
        <div>
          <h1>Library</h1>
          <p>{recordings.length} recording{recordings.length !== 1 ? "s" : ""} saved locally</p>
        </div>
        <button className="btn-primary-sm" onClick={() => navigate("/recorder")}>
          + New Recording
        </button>
      </div>

      {/* Load error */}
      {loadError && (
        <div className="lib-error">{loadError}</div>
      )}

      {/* Search + Filter bar */}
      <div className="library-toolbar">
        <div className="search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search recordings..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="tag-filters">
          {TAGS.map((tag) => (
            <button
              key={tag}
              className={`tag-btn ${filter === tag ? "active" : ""}`}
              onClick={() => setFilter(tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <span>📭</span>
          <p>
            {recordings.length === 0
              ? "No recordings yet — start one from the Recorder!"
              : "No recordings match your search."}
          </p>
        </div>
      ) : (
        <div className="recordings-grid">
          {filtered.map((rec) => (
            <div className="recording-card" key={rec.id}>

              {/* Thumbnail */}
              <div className="card-thumb">
                {blobUrls[rec.id] ? (
                  <video
                    src={blobUrls[rec.id]}
                    className="card-thumb-video"
                    muted
                    preload="metadata"
                    onLoadedMetadata={(e) => { e.target.currentTime = 1; }}
                  />
                ) : (
                  <span>{rec.thumb ?? "🖥️"}</span>
                )}
                <div className="card-duration">{rec.duration}</div>
              </div>

              {/* Body */}
              <div className="card-body">
                <span className="card-tag">{rec.tag}</span>

                {/* Title — normal or rename input */}
                {renamingId === rec.id ? (
                  <RenameInput
                    initial={rec.title}
                    onSave={(newTitle) => handleRename(rec.id, newTitle)}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <h3 className="card-title">{rec.title}</h3>
                )}

                <div className="card-meta">
                  <span>📅 {rec.date}</span>
                  <span>💾 {rec.size}</span>
                </div>
              </div>

              {/* Actions */}
              <div className="card-actions">
                <button
                  className="card-btn"
                  title="Play"
                  onClick={() => handlePlay(rec)}
                >
                  ▶️ Play
                </button>
                <button
                  className="card-btn"
                  title="Edit"
                  onClick={() => navigate(`/editor?id=${rec.id}`)}
                >
                  ✂️ Edit
                </button>
                <button
                  className="card-btn"
                  title="Rename"
                  onClick={() => setRenamingId(rec.id)}
                >
                  ✏️ Rename
                </button>
                <button
                  className="card-btn"
                  title="Download"
                  onClick={() => handleDownload(rec)}
                >
                  ⬇️
                </button>
                <button
                  className="card-btn danger"
                  title="Delete"
                  onClick={() => handleDelete(rec.id)}
                >
                  🗑️
                </button>
              </div>

            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Library;
