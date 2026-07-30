import type { Metadata, Viewport } from "next";
import PwaControls from "./PwaControls";
import "./globals.css";

export const metadata: Metadata = {
  title: "ItsMyToy Operations",
  description: "Production foundation for controlled shop operations.",
  applicationName: "ItsMyToy Operations",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "ItsMyToy",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#16324f",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <PwaControls />
      </body>
    </html>
  );
}
