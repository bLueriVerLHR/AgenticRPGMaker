/**
 * Editor app shell (P0 placeholder, ADR-006). The full map/event editor ships
 * in P2; this renders a static placeholder so the Vite build and dev server
 * prove out the shell.
 */
export function App(): React.JSX.Element {
  return (
    <main style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: "48rem" }}>
      <h1>AgenticRPGMaker — Editor</h1>
      <p>
        Placeholder shell (P0). The full map/event editor (tile layers, event placement,
        runtime preview) ships in P2.
      </p>
      <ul>
        <li>Packages: <code>@agenticrpg/core</code> (shared data model + schemas)</li>
        <li>Stack: React + TypeScript + Vite (ADR-006)</li>
      </ul>
    </main>
  );
}
