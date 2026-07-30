"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useOnlineStatus } from "@/client/use-online-status";

type InstallPrompt = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function subscribeToDisplayMode(callback: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

function canOfferIosInstall() {
  const iosNavigator = navigator as Navigator & { standalone?: boolean };
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
    && !window.matchMedia("(display-mode: standalone)").matches
    && iosNavigator.standalone !== true;
}

export default function PwaControls() {
  const online = useOnlineStatus();
  const iosInstallAvailable = useSyncExternalStore(
    subscribeToDisplayMode,
    canOfferIosInstall,
    () => false,
  );
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt>();
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        void navigator.serviceWorker.register("/sw.js");
      } else {
        void navigator.serviceWorker.getRegistrations()
          .then((registrations) => Promise.all(
            registrations.map((registration) => registration.unregister()),
          ));
      }
    }

    const handleInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    const handleInstalled = () => {
      setInstallPrompt(undefined);
      setInstalled(true);
      setShowIosHelp(false);
    };

    window.addEventListener("beforeinstallprompt", handleInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  async function install() {
    if (!installPrompt) {
      setShowIosHelp(true);
      return;
    }

    await installPrompt.prompt();
    await installPrompt.userChoice;
    setInstallPrompt(undefined);
  }

  return (
    <>
      <aside
        className={`pwa-controls ${online ? "online" : "offline"}`}
        aria-label="Connection status"
        role="status"
      >
        <span className="connection-dot" aria-hidden="true" />
        <strong>{online ? "Online" : "Offline"}</strong>
        {!online && <span>Live stock and checkout are paused.</span>}
        {!installed && (installPrompt || iosInstallAvailable) && (
          <button type="button" onClick={install}>
            Install app
          </button>
        )}
      </aside>

      {showIosHelp && (
        <section className="install-help" aria-label="Install ItsMyToy">
          <button
            type="button"
            className="install-help-close"
            aria-label="Close install instructions"
            onClick={() => setShowIosHelp(false)}
          >
            ×
          </button>
          <strong>Install ItsMyToy</strong>
          <p>In Safari, tap Share, then choose Add to Home Screen.</p>
        </section>
      )}
    </>
  );
}
