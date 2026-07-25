import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ItsMyToy Operations",
    short_name: "ItsMyToy",
    description: "Controlled toy-shop operations.",
    start_url: "/",
    display: "standalone",
    background_color: "#eef4f7",
    theme_color: "#16324f",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
