import type { Metadata, Viewport } from "next";
import { getTenant } from "@/lib/tenant";
import "./globals.css";

export function generateMetadata(): Metadata {
  const { company } = getTenant();
  return {
    title: `${company.shortName} Assistent`,
    description: `KI-Assistent für ${company.name}: Fragen zu Pflege, Pflegegrad und Kosten – auf Deutsch und Russisch, schriftlich oder per Stimme.`,
    robots: { index: false, follow: false },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F1F5F3" },
    { media: "(prefers-color-scheme: dark)", color: "#0F1C1E" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
