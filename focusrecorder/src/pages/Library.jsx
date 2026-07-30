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
function PlayModal({ rec, url, onClose }) {
  // Close on backdrop click or Escape key
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="play-modal-backdrop" onClick={onClose}>
      <div className="play-modal" onClick={(e) => e.stopPropagation()}>
        <div className="play-modal-header">
          <span className="play-modal-title">{rec.title}</span>
          <button className="play-modal-close" onClick={onClose}>✕</button>
        </div>
        <video
          className="play-modal-video"
          src={url}
          controls
          autoPlay
        />
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
