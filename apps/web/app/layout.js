export const metadata = {
  title: "PhotoX",
  description: "Personal photo platform"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#f7f8fa" }}>
        {children}
      </body>
    </html>
  );
}
