import { useEffect, useState } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL ?? "http://localhost:3001";

export function useTwitchLive() {
  const [isLive, setIsLive] = useState(false);
  const [loading, setLoading] = useState(true);

  async function checkLive() {
    try {
      const res = await fetch(`${SERVER_URL}/auth/live`);
      const { live } = await res.json();

      setIsLive(live);
    } catch (err) {
      console.error("Failed to check Twitch status:", err);
      setIsLive(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkLive();

    const interval = setInterval(checkLive, 60000);

    return () => clearInterval(interval);
  }, []);

  return {
    isLive,
    loading,
  };
}
