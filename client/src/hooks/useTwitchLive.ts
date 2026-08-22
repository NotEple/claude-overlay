import { useEffect, useRef, useState } from "react";
import { useToast } from "../components/ToastProvider";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export function useTwitchLive() {
  const toast = useToast();
  const errorShownRef = useRef(false);
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  async function checkLive() {
    try {
      const res = await fetch(`${SERVER_URL}/auth/live`);
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const { live } = await res.json();

      setIsLive(live);
      errorShownRef.current = false;
    } catch (err) {
      console.error("Failed to check Twitch status:", err);
      if (!errorShownRef.current) {
        toast.error("Could not check whether the Twitch stream is live");
        errorShownRef.current = true;
      }
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkLive();

    const interval = setInterval(checkLive, 60000);

    return () => clearInterval(interval);
  }, [toast]);

  return {
    isLive,
    loading,
  };
}
