import { useTwitchLive } from "../hooks/useTwitchLive";
import vicksyWLIVE from "../assets/vicksyWLIVE.png";
import vicksyW from "../assets/vicksyW.png";
import { useEffect } from "react";

export default function TileController() {
  const { isLive } = useTwitchLive();

  const favicon = document.getElementById("favicon") as HTMLLinkElement;

  useEffect(() => {
    if (isLive) {
      favicon.href = vicksyWLIVE;
      document.title = `(LIVE) OBS Overlay | Vicksy`;
    } else {
      favicon.href = vicksyW;
      document.title = `OBS Overlay | Vicksy`;
    }
  });

  return null;
}
