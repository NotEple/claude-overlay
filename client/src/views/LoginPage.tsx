import { useEffect } from "react";
import { useToast } from "../components/ToastProvider";
import campfireFoxes from "../assets/foxsittingverycomfortablearoundacampfirewithitsfriends-4x.gif";

interface LoginPageProps {
  onLogin: () => void;
  error?: string | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  twitch_denied: 'You cancelled the Twitch login.',
  invalid_state: 'Something went wrong. Please try again.',
  not_whitelisted: "Your Twitch account hasn't been added to this overlay. Ask the owner to add you.",
  server_error: 'A server error occurred. Please try again.',
  session_revoked: 'Your access was revoked. Ask the owner to re-add you if this is a mistake.',
};

export function LoginPage({ onLogin, error }: LoginPageProps) {
  const toast = useToast();
  useEffect(() => {
    if (error) toast.error(ERROR_MESSAGES[error] ?? 'Something went wrong.');
  }, [error, toast]);

  return (
    <main className="login-screen">
      <div className="login-glow login-glow--one" />
      <div className="login-glow login-glow--two" />
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__eyebrow"><span /> PRIVATE STREAM CONTROL</div>
        <div className="login-card__copy">
          <h1 id="login-title">Vicksy’s OBS Overlay</h1>
          <p>A cozy little control room for bringing the stream to life.</p>
        </div>
        <img className="login-card__art" src={campfireFoxes} alt="Fox friends relaxing around a campfire" />
        <button
          onClick={onLogin}
          title="Authenticate with Twitch to open the dashboard"
          className="ui-button login-twitch-button"
        >
          <TwitchIcon />
          Continue with Twitch
        </button>
        <p className="login-card__notice">Only approved Twitch accounts can access this dashboard.</p>
      </section>
    </main>
  );
}

function TwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}
