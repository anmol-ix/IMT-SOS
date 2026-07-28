"use client";

import { useEffect } from "react";
import { clearOfflineAccess } from "@/client/offline-storage";

export default function ClearOfflineAccess() {
  useEffect(() => {
    void clearOfflineAccess();
  }, []);
  return null;
}
