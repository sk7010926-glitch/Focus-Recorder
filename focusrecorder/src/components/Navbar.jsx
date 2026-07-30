import { useState, useEffect } from "react";
import { NavLink, useLocation } from "react-router-dom";
import "./Navbar.css";

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const location = useLocation();

  // Close mobile menu whenever the route changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsOpen(false);
  }, [location]);

  // Lock body scroll while mobile overlay is open
  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  const toggleMenu = () => setIsOpen((prev) => !prev);

  const navLinks = [
    { path: "/",         label: "Home",     end: true },
    { path: "/recorder", label: "Recorder"            },
    { path: "/library",  label: "Library"             },
    { path: "/editor",   label: "Editor"              },
    { path: "/settings", label: "Settings"            },
  ];

  return (
    <>
      {/* Sticky Navbar Bar */}
      <nav className="navbar">
        <div className="navbar-container">

          {/* Logo */}
          <NavLink to="/" end className="navbar-logo">
            <span className="logo-icon">🎥</span>
            <span className="logo-text">FocusRecord</span>
          </NavLink>

          {/* Desktop links */}
          <ul className="navbar-links">
            {navLinks.map((link) => (
              <li key={link.path}>
                <NavLink
                  to={link.path}
                  end={link.end}
                  className={({ isActive }) =>
                    isActive ? "nav-item active" : "nav-item"
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>

          {/* Hamburger button (mobile) */}
          <button
            className={`hamburger${isOpen ? " is-active" : ""}`}
            onClick={toggleMenu}
            aria-label="Toggle navigation menu"
            aria-expanded={isOpen}
          >
            <span className="bar" />
            <span className="bar" />
            <span className="bar" />
          </button>
        </div>
      </nav>

      {/* Mobile overlay — outside <nav> to avoid stacking context trap */}
      <div
        className={`mobile-menu${isOpen ? " show" : ""}`}
        aria-hidden={!isOpen}
      >
        <ul className="mobile-links">
          {navLinks.map((link) => (
            <li key={link.path}>
              <NavLink
                to={link.path}
                end={link.end}
                className={({ isActive }) =>
                  isActive ? "mobile-nav-item active" : "mobile-nav-item"
                }
              >
                {link.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

export default Navbar;
