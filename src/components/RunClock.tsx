import { useEffect, useState } from "react";

export function RunClock({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.floor((now - since) / 1000));
  const mm = Math.floor(secs / 60);
  const ss = String(secs % 60).padStart(2, "0");
  return (
    <span className="chg-stat" data-run-clock aria-label="Elapsed time">
      {mm}:{ss}
    </span>
  );
}
