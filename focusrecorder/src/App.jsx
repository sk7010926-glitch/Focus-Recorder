import "./App.css";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import Recorder from "./pages/Recorder";
import Library from "./pages/Library";
import Editor from "./pages/Editor";
import Settings from "./pages/Settings";

import { useTheme } from "./hooks/useTheme";

function App() {
  // Initialize theme on app load and keep it synced
  useTheme();

  return (
    <BrowserRouter>
      {/* Navbar is visible on every page */}
      <Navbar />

      {/* Route definitions for each page */}
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/recorder" element={<Recorder />} />
        <Route path="/library" element={<Library />} />
        <Route path="/editor" element={<Editor />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;