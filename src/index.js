import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Set the marble background image at runtime — referencing a public-path URL from CSS
// breaks CRA's webpack resolution, so we apply it via the body's style here.
const PUBLIC = (process.env.PUBLIC_URL || ".") + "/menu_marble_frame.png";
document.body.style.backgroundImage =
  `linear-gradient(rgba(15,17,18,0.55), rgba(15,17,18,0.55)), url("${PUBLIC}")`;

const root = createRoot(document.getElementById("root"));
root.render(<App />);
