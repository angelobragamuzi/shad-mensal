import type { Metadata } from "next";
import { Sora } from "next/font/google";
import "./globals.css";

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Shad Manager | ShadSolutions",
  description: "Gestao inteligente de mensalidades.",
  icons: {
    icon: "/icon-logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var key='shad-theme';var saved=localStorage.getItem(key);var system=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';var theme=(saved==='light'||saved==='dark')?saved:system;document.documentElement.setAttribute('data-theme',theme);document.documentElement.style.colorScheme=theme;}catch(_){document.documentElement.setAttribute('data-theme','dark');document.documentElement.style.colorScheme='dark';}})();`,
          }}
        />
      </head>
      <body className={`${sora.variable} antialiased`}>{children}</body>
    </html>
  );
}


