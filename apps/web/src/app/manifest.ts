import type { MetadataRoute } from "next";

// PWA manifest (#149). Next.js 16 native metadata route — the
// framework serves it at `/manifest.webmanifest` with the right
// content-type header automatically.
//
// Installability criteria (Chrome): needs name, short_name,
// start_url, display=standalone, 192×192 + 512×512 icons, and
// a service worker. The no-op sw.js in /public satisfies the
// last bullet without introducing an offline-caching strategy
// (that's out of scope and filed as a follow-up).
//
// theme_color matches the --conduit-green from #90's AA palette;
// the browser chrome (status bar on mobile, title bar on desktop)
// tints to this color when the app is installed. Dark-mode
// theme-color is set via a separate <meta> in layout.tsx because
// the manifest format only supports a single value.

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Conduit",
    short_name: "Conduit",
    description: "A place to share your knowledge.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2c7a2c",
    categories: ["social", "news", "productivity"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
