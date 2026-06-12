import 'express-session';

declare module 'express-session' {
  interface SessionData {
    user?: {
      id: string;
      login: string;
      displayName: string;
      avatar: string;
      color: string;       // Twitch chat color, e.g. "#FF0000"
      isOwner: boolean;
      isAdmin: boolean;
    };
    oauthState?: string;
  }
}
