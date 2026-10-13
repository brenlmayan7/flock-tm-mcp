export const metadata = { title: "Flock TM MCP" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body style={{ fontFamily: "system-ui", padding: 24 }}>{children}</body>
    </html>
  );
}
