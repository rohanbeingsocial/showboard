import { createRoot } from "react-dom/client";
import "showboard/styles.css";
import "./app.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
