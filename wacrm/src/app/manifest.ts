import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MboWazap CRM — Autonomous WhatsApp Growth OS",
    short_name: "MboWazap",
    description:
      "24/7 Autonomous Jarvis AI Employee, WhatsApp CRM Inbox, Marketing Growth OS & Omnichannel Analytics.",
    start_url: "/dashboard",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0c0f17",
    theme_color: "#0c0f17",
    icons: [
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
