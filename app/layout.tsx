import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AG IA Esportes",
  description: "Sistema profissional de tracking de apostas esportivas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen bg-background font-sans antialiased">{children}</body>
    </html>
  );
}
