import "./App.css";
import { useAuth } from "./hooks/useAuth";
import { Dashboard } from "./views/Dashboard";
import { Overlay } from "./views/Overlay";
import { LoginPage } from "./views/LoginPage";
import TileController from "./components/TileController";
import { ToastProvider } from "./components/ToastProvider";

export default function App() {
  if (window.location.pathname === "/overlay") return <Overlay />;
  return (
    <ToastProvider>
      <DashboardApp />
    </ToastProvider>
  );
}

function DashboardApp() {
  const { user, loading, login, logout, refreshUser } = useAuth();
  const error = new URLSearchParams(window.location.search).get("error");

  const handleSessionRevoked = () => {
    window.location.href = "/login?error=session_revoked";
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#0d0d0d",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent-text)",
            animation: "pulse 1s infinite",
          }}
        />
      </div>
    );
  }

  if (!user) return <LoginPage onLogin={login} error={error} />;

  return (
    <>
      <TileController />
      <Dashboard
        user={user}
        onLogout={logout}
        onSessionRevoked={handleSessionRevoked}
        onRoleUpdated={refreshUser}
      />
    </>
  );
}
