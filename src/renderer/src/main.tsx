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

// La classe porte la transparence du fond : la fenêtre du panneau est
// transparente, le `body` opaque de l'application y ferait des coins noirs.
if (estOverlay) document.body.classList.add("is-overlay");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{estOverlay ? <OverlayRoot /> : <App />}</StrictMode>
);
