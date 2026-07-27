import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ItsMyToy Operations",
    short_name: "ItsMyToy",
    description: "Controlled toy-shop operations.",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#eef4f7",
    theme_color: "#16324f",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
