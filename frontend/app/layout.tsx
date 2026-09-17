import type { Metadata, Viewport } from "next";
import { Providers } from "@/lib/session";
import "./globals.css";

export const metadata: Metadata = {
  title: "Disco Campaign Studio",
  description: "Describe your business; get ranked publishers, persona-tuned creative and a runnable campaign config — with every decision explained.",
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
        {/* apply the saved theme before first paint to avoid a flash */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('dcs.theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}` }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
