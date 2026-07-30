import { useNavigate } from "react-router-dom";
import "./Home.css";

const FEATURES = [
  {
    icon: "🖥️",
    title: "Screen Recording",
    desc: "Capture your entire screen, a specific window, or a browser tab with crystal-clear quality up to 4K.",
  },
  {
    icon: "🎙️",
    title: "Microphone & System Audio",
    desc: "Record your voice and system sounds simultaneously — perfect for tutorials and walkthroughs.",
  },
  {
    icon: "📷",
    title: "Webcam Overlay",
    desc: "Add a picture-in-picture webcam feed so your audience can see you while you present.",
  },
  {
    icon: "✂️",
    title: "Built-in Editor",
    desc: "Trim, cut, and annotate your recordings right inside the app — no extra software needed.",
  },
  {
    icon: "📂",
    title: "Local Library",
    desc: "All recordings stay on your device. Browse, search, and organise your library with ease.",
  },
  {
    icon: "⚡",
    title: "Instant Export",
    desc: "Export in MP4, WebM, or GIF in seconds. Share a link or save locally — your choice.",
  },
];

const STATS = [
  { value: "4K", label: "Max Resolution" },
  { value: "60fps", label: "Frame Rate" },
  { value: "100%", label: "Local & Private" },
  { value: "0ms", label: "Latency" },
];

function Home() {
  const navigate = useNavigate();

  return (
    <div className="home">
      {/* ── Hero ── */}
      <section className="hero">
        <div className="glow glow-1" />
        <div className="glow glow-2" />

        <span className="hero-badge">✨ Now with 4K recording</span>

        <h1 className="hero-title">
          Record anything.{" "}
          <span className="gradient-text">Share everything.</span>
        </h1>

        <p className="hero-sub">
          FocusRecord is a privacy-first screen recorder that lives entirely on
          your device. No cloud, no subscriptions — just pure, powerful
          recording.
        </p>

        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => navigate("/recorder")}>
            🎬 Start Recording
          </button>
          <button className="btn btn-ghost" onClick={() => navigate("/library")}>
            📂 View Library
          </button>
        </div>
      </section>

      {/* ── Stats Strip ── */}
      <div className="stats">
        {STATS.map((s) => (
          <div className="stat-item" key={s.label}>
            <span className="stat-value">{s.value}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* ── Features ── */}
      <section className="features">
        <h2 className="section-title">Everything you need. Nothing you don't.</h2>
        <p className="section-sub">
          A focused toolset built for developers, designers, and educators.
        </p>

        <div className="features-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── CTA Banner ── */}
      <div className="cta-banner">
        <h2>Ready to hit record?</h2>
        <p>It only takes one click to start capturing your screen.</p>
        <button className="btn btn-primary" onClick={() => navigate("/recorder")}>
          🔴 Start Recording Now
        </button>
      </div>
    </div>
  );
}

export default Home;
