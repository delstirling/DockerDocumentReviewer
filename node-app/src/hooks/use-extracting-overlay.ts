"use client";

import { useEffect, useRef, useState } from "react";

export function useExtractingOverlay() {
  const [isExtracting, setIsExtracting] = useState(false);
  const [substatus, setSubstatus] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (isExtracting) {
      timerRef.current = window.setTimeout(() => {
        setSubstatus("Still working…");
      }, 8000);
    } else {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setSubstatus(null);
    }
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [isExtracting]);

  return { isExtracting, setIsExtracting, substatus };
}
