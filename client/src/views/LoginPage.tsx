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
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Twitch-purple accent dot */}
        <div className="w-3 h-3 rounded-full bg-purple-500" />

        <div>
          <h1 className="text-2xl font-semibold text-white">OBS Overlay</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in with Twitch to continue</p>
        </div>

        {error && (
          <p className="text-red-400 text-sm bg-red-950 border border-red-800 rounded-md px-4 py-2 max-w-xs">
            {ERROR_MESSAGES[error] ?? 'Something went wrong.'}
          </p>
        )}

        <button
          onClick={onLogin}
          className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 text-white text-sm font-medium rounded-md transition-colors"
        >
          <TwitchIcon />
          Login with Twitch
        </button>
      </div>
    </div>
  );
}

function TwitchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}
