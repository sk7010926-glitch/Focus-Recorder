import { NavLink } from "react-router-dom";

function Navbar() {
    return (
        <nav>
            <h2>FocusRecorder</h2>

            <ul>
                <li>
                    <NavLink to="/">Home</NavLink>
                </li>
                <li>
                    <NavLink to="/recorder">Recorder</NavLink>
                </li>
                <li>
                    <NavLink to="/library">Library</NavLink>
                </li>
                <li>
                    <NavLink to="/editor">Editor</NavLink>
                </li>
                <li>
                    <NavLink to="/settings">Settings</NavLink>
                </li>
            </ul>
        </nav>
    );
}

export default Navbar;