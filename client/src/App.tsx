import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { Dashboard } from "./views/Dashboard";
import { Overlay } from "./views/Overlay";
import { LoginPage } from "./views/LoginPage";
import { ToastProvider } from "./components/ToastProvider";
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
  const { user, loading, login, logout, refreshUser } = useAuth();
  const searchParams = new URLSearchParams(window.location.search);
  const error = searchParams.get("error");
  const previewLoading = searchParams.get("preview") === "loading";

  const handleSessionRevoked = () => {
    window.location.href = "/login?error=session_revoked";
  };

  if (loading || previewLoading) return <LoadingScreen />;

  if (!user) return <LoginPage onLogin={login} error={error} />;

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
