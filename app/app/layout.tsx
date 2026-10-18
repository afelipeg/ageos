import { type Metadata } from "next"
import { Geist, Geist_Mono } from "next/font/google"

import "./globals.css"
import { Suspense } from "react"

import { I18nProvider } from "@/components/i18n/i18n-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { TopProgressBar } from "@/components/top-progress-bar"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { getLocale } from "@/server/i18n"

// Vercel theme typography: Geist drives --font-sans (and headings), Geist Mono
// --font-mono. globals.css maps both through --font-geist-* with fallbacks.
const fontSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" })

const fontMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

const APP_NAME = "AgeOS"

// Resolves the stored theme ("light" | "dark" | "system"; missing means the
// "dark" default) with next-themes' defaults (storageKey "theme", class
// attribute). next-themes injects its own script inside <body>, which runs
// after the first content is already painted; this one sits first in <head>
// so the correct class and color-scheme exist before any paint.
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem("theme");var r=t==="light"||t==="dark"?t:t==="system"?(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):"dark";var e=document.documentElement;e.classList.remove("light","dark");e.classList.add(r);e.style.colorScheme=r}catch(_){}})()`

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — Build your agency on AgeOS`,
    template: `%s · ${APP_NAME}`,
  },
  description:
    "Your clients, work, media and finances — configured around the way your agency operates. Executable demo with synthetic data.",
  applicationName: APP_NAME,
  robots: { index: false, follow: false },
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = await getLocale()
  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={cn("antialiased", "dark", fontSans.variable, fontMono.variable, "font-sans")}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body suppressHydrationWarning>
        <ThemeProvider>
          <Suspense fallback={null}>
            <TopProgressBar />
          </Suspense>
          <I18nProvider locale={locale}>
            <TooltipProvider>{children}</TooltipProvider>
          </I18nProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
