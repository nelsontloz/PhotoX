export default function HomePage() {
  return (
    <main style={{ maxWidth: 860, margin: "40px auto", padding: 24 }}>
      <h1 style={{ margin: 0 }}>PhotoX Personal Edition</h1>
      <p style={{ color: "#555" }}>
        Web app scaffold is running. Connect API routes and UI modules from the implementation backlog.
      </p>
      <ul>
        <li>Upload pipeline</li>
        <li>Timeline</li>
        <li>Albums and sharing</li>
        <li>Search and faces</li>
        <li>Memories</li>
      </ul>
    </main>
  );
}
