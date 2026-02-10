import type { Metadata } from "next";
import Script from "next/script";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Alex",
  description: "Personal library software",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html: `(() => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = (isDark) => {
    document.documentElement.classList.toggle('dark', isDark);
  };
  apply(media.matches);
  const handler = (event) => apply(event.matches);
  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', handler);
  } else {
    media.addListener(handler);
  }
})();`,
          }}
        />
      </head>
      <body className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
