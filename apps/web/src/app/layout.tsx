import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AntdProvider } from "@/providers/Antd";
import { Auth0Provider } from "@/providers/Auth0";
import { QueryProvider } from "@/providers/Query";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Task List",
  description: "Auth0-authenticated task list",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body>
        {/* Auth0 outermost: the API client reads the token it publishes, and
            TanStack Query's fetches all go through that client. */}
        <AntdProvider>
          <Auth0Provider>
            <QueryProvider>{children}</QueryProvider>
          </Auth0Provider>
        </AntdProvider>
      </body>
    </html>
  );
}
