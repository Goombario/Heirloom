import type { Metadata, Viewport } from "next";
import { Fraunces, Inter, JetBrains_Mono, Literata } from "next/font/google";
import "./globals.css";
import Navbar from "./components/Navbar";
import { ThemeProvider } from "./components/ThemeProvider";
import { AuthProvider } from "./components/AuthProvider";
import SignInGate from "./components/SignInGate";
import { LanguageProvider } from "./components/LanguageProvider";
import { TreeProvider } from "./contexts/TreeContext";
import SharedTreeBanner from "./components/SharedTreeBanner";
import GlobalSearch from "./components/GlobalSearch";
import LocalFirstRunNotice from "./components/LocalFirstRunNotice";
import BackupNudge from "./components/backup/BackupNudge";
import { PageNoticeProvider } from "./components/ui/PageNotice";
import DiagOverlay from "./components/DiagOverlay";
import DbWarmup from "./components/DbWarmup";
import RegisterServiceWorker from "./components/RegisterServiceWorker";
import DesktopWindowFit from "./components/DesktopWindowFit";
import { AppToaster } from "./components/ui";
import { UnsavedChangesProvider } from "./components/UnsavedChangesProvider";
import { SkipLink } from '@/app/components/SkipLink';

// `subsets` only picks what is preloaded: next/font ships every subset's
// @font-face (unicode-range), so Inter and JetBrains Mono already render
// Cyrillic and Latin Extended on demand without adding to every page's preload.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz"],
  // Fraunces has no Cyrillic at all (#703). Its metric-matched fallback face
  // is an unranged local() serif that would claim Cyrillic before Literata
  // could, so it is off: Cyrillic falls through to Literata instead.
  adjustFontFallback: false,
});

// Cyrillic stand-in for Fraunces, second in `--font-serif`. Not preloaded:
// only a Russian page fetches it, and only its Cyrillic faces get used.
const literata = Literata({
  variable: "--font-literata",
  subsets: ["cyrillic"],
  axes: ["opsz"],
  preload: false,
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: { default: "Heirloom", template: "%s - Heirloom" },
  description: "Organize your family tree securely and privately",
  // PWA: the manifest is served dynamically from app/manifest.ts. appleWebApp
  // makes iOS "Add to Home Screen" launch standalone (no Safari chrome).
  // statusBarStyle 'black-translucent' makes the status bar transparent so the
  // webview extends UNDER it (under viewport-fit=cover) — the nav then paints its
  // own --color-nav-bg into the notch/status-bar zone via its env(safe-area-inset-top)
  // padding, instead of iOS drawing a solid neutral bar above the content. White
  // status-bar glyphs are legible against the dark slate nav.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Heirloom" },
  // Explicit apple-touch-icon link (Next doesn't auto-link assets from public/).
  icons: { apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Tints the browser/status-bar chrome to the nav colour (also polishes the
  // Safari tab top, not just standalone), per light/dark theme.
  // An UNCONDITIONAL base value must come first — iOS Safari ignores theme-color
  // in a tab when only prefers-color-scheme variants are given (no default to fall
  // back to), leaving the status-bar zone its default grey. Base = slate nav colour;
  // the dark-scheme variant refines it. (App theme is a manual html class, so the
  // media query tracks the OS, not the in-app toggle: light slate, dark warm charcoal.)
  themeColor: [
    { color: "#475569" },
    { media: "(prefers-color-scheme: dark)", color: "#2B2622" },
  ],
  // Edge-to-edge: the app-shell (mobile) scrolls an inner region, not the
  // document, so iOS Safari no longer paints content behind its chrome — which
  // makes viewport-fit=cover safe again. Cover lets the nav fill the notch/
  // status-bar zone with its own colour and the form footer clear the home
  // indicator, both via env(safe-area-inset-*) padding on those bars.
  viewportFit: "cover",
  // Shrink the layout viewport when the soft keyboard opens so bottom-anchored
  // and dvh-sized UI (e.g. the mobile "Who is this?" tagging tray, form footers)
  // sits above the keyboard instead of being hidden behind it.
  interactiveWidget: "resizes-content",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      // next/font variable classes live on <html> so --font-fraunces /
      // --font-inter / --font-jetbrains-mono exist at :root, where the
      // @theme --font-serif/-mono/-sans aliases in globals.css read them.
      // On <body> they only reached descendants, leaving the aliases empty
      // and the font-serif/-mono utilities silently falling back to Inter (#342).
      className={`${fraunces.variable} ${literata.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/* Apply the saved theme before first paint so light-mode users on a
            dark OS don't get a black flash before hydration. Mirrors ThemeProvider. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme');var d=document.documentElement;if(t==='dark'){d.classList.add('dark');}else if(t==='light'){d.classList.add('light');}if(localStorage.getItem('statusSymbols')==='true'){d.setAttribute('data-status-symbols','on');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="antialiased">
        <AuthProvider>
          <SignInGate />
          <LanguageProvider>
          <ThemeProvider>
            <TreeProvider>
              <UnsavedChangesProvider>
                <SkipLink />
                <div className="app-shell">
                  <Navbar />
                  <div className="app-scroll">
                    {/* Banners lead the scroll region so they sit directly under the
                        sticky nav. BackupNudge has no positioning of its own — as a
                        sibling of .app-shell it rendered below every page's content,
                        at the bottom of the document. */}
                    <BackupNudge />
                    <SharedTreeBanner />
                    {/* The phone reminder goes under each page's own header (#1130). */}
                    <PageNoticeProvider value={<BackupNudge placement="page" />}>
                      {children}
                    </PageNoticeProvider>
                  </div>
                </div>
                {/* Safari 26's phone status-bar colour (#1099): see .top-edge-tint in globals.css. */}
                <div className="top-edge-tint" aria-hidden="true" />
                <DiagOverlay />
                <DbWarmup />
                <RegisterServiceWorker />
                <DesktopWindowFit />
                <GlobalSearch />
                <LocalFirstRunNotice />
                <AppToaster />
              </UnsavedChangesProvider>
            </TreeProvider>
          </ThemeProvider>
          </LanguageProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
