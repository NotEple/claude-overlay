import { useTwitchLive } from "../hooks/useTwitchLive";
import vicksyWLIVE from "../assets/vicksyWLIVE.png";
import vicksyW from "../assets/vicksyW.png";
import { useEffect } from "react";

export default function TileController({ channel }: { channel: string }) {
  const { isLive } = useTwitchLive(channel);
  const channelName = channel.charAt(0).toUpperCase() + channel.slice(1);

  const favicon = document.getElementById("favicon") as HTMLLinkElement;

  useEffect(() => {
    if (isLive) {
      favicon.href = vicksyWLIVE;
      document.title = `(LIVE) OBS Overlay | ${channelName}`;
    } else {
      favicon.href = vicksyW;
      document.title = `OBS Overlay | ${channelName}`;
    }
  }, [channelName, favicon, isLive]);

  return null;
}
