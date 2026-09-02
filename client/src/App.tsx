import { useEffect } from "react";
import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { Dashboard, customAccentVariables } from "./views/Dashboard";
import { Overlay } from "./views/Overlay";
import { LoginPage } from "./views/LoginPage";
import { ToastProvider, useToast } from "./components/ToastProvider";
import vicksySpin from "./assets/vicksySpin.gif";
import TileController from "./components/TileController";

export default function App() {
  if (window.location.pathname === "/overlay") {
    return (
      <ToastProvider>
        <TileController channel="vicksy" />
        <Overlay />
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      <DashboardApp />
    </ToastProvider>
  );
}

function DashboardApp() {
  const toast = useToast();
  const { user, loading, login, logout, refreshUser } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const error = searchParams.get("error");
  const previewLoading = searchParams.get("preview") === "loading";
  const savedTheme = localStorage.getItem("dashboard_theme");
  const theme = savedTheme === "custom" || savedTheme === "indigo" ? "custom" : "fox";
  const customAccent = localStorage.getItem("dashboard_custom_accent") ?? "#4f46e5";
  const themedScreen = (screen: React.ReactNode) => (
    <div
      data-theme={theme}
      style={theme === "custom" ? customAccentVariables(customAccent) : undefined}
    >
      {screen}
    </div>
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("events_connected");
    const eventError = params.get("events_error");
    const actualAccount = params.get("events_actual");
    if (connected) toast.success(`Twitch Events connected to ${connected}`);
    if (eventError) {
      const message = eventError.startsWith("expected_")
        ? `Authorize the ${eventError.slice(9)} Twitch account, not ${actualAccount ?? "the currently signed-in account"}`
        : ({
            twitch_denied: "Twitch Events authorization was cancelled or denied",
            authorization: "The Twitch authorization response was invalid or expired",
            token_exchange: "Twitch could not exchange the authorization code. Check the server log and redirect URL",
            account_lookup: "Twitch authorized the token but the account could not be read",
            database_save: "Twitch authorization succeeded, but saving the encrypted token failed",
            eventsub_registration: "Authorization was saved, but Twitch could not register the event subscriptions. Check the server log",
          } as Record<string, string>)[eventError] ?? "Twitch Events authorization failed";
      toast.error(message);
    }
    if (connected || eventError) {
      params.delete("events_connected");
      params.delete("events_error");
      params.delete("events_actual");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, [toast]);

  const handleSessionRevoked = () => {
    window.location.href = "/login?error=session_revoked";
  };

  if (loading || previewLoading) return themedScreen(<LoadingScreen />);

  if (!user) return themedScreen(<LoginPage onLogin={login} error={error} />);

  return (
    <>
      <Dashboard
        user={user}
        onLogout={logout}
        onSessionRevoked={handleSessionRevoked}
        onRoleUpdated={refreshUser}
      />
    </>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite" aria-busy="true">
      <div className="loading-screen__content">
        <img src={vicksySpin} alt="Vicksy spinning while the overlay loads" />
        <div>
          <h1>Loading Vicksy’s overlay…</h1>
          <p>Waking the server and checking your access. This can take a moment.</p>
        </div>
        <div className="loading-screen__progress"><span /></div>
      </div>
    </main>
  );
}
