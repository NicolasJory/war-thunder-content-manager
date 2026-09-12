/**
 * Un seul bundle, deux fenêtres.
 *
 * Le panneau flottant partage tout avec l'application — traductions, appels,
 * bouton d'installation — donc il ne mérite ni son build ni sa copie du
 * contexte. Le main lui passe `#overlay` dans l'URL, c'est le seul écart.
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { OverlayRoot } from "./OverlayRoot";
import "./styles.css";

const estOverlay = window.location.hash === "#overlay";

createRoot(document.getElementById("root")!).render(
  <StrictMode>{estOverlay ? <OverlayRoot /> : <App />}</StrictMode>
);
