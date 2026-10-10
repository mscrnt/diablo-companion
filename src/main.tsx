import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/800.css";
import "@fontsource-variable/inter";
import "./styles.css";

const view = new URLSearchParams(location.search).get("view");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

if (view === "overlay") {
  document.body.classList.add("overlay");
  import("./overlay/Overlay").then(({ default: Overlay }) => root.render(<Overlay />));
} else {
  import("./App").then(({ default: App }) =>
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    ),
  );
}
