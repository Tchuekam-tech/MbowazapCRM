"use client";

import { createContext, useContext, useState, useCallback, useMemo } from "react";

interface MobileChromeContextValue {
  /** Pages like Inbox (when a thread is open on mobile) can hide the floating dock so the message composer has full room. */
  hideMobileDock: boolean;
  setHideMobileDock: (hidden: boolean) => void;
  /** Opens the tactile slide-up Quick-Action sheet from anywhere on mobile. */
  quickSheetOpen: boolean;
  setQuickSheetOpen: (open: boolean) => void;
  toggleQuickSheet: () => void;
}

const MobileChromeContext = createContext<MobileChromeContextValue>({
  hideMobileDock: false,
  setHideMobileDock: () => {},
  quickSheetOpen: false,
  setQuickSheetOpen: () => {},
  toggleQuickSheet: () => {},
});

export function MobileChromeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [hideMobileDock, setHideMobileDock] = useState(false);
  const [quickSheetOpen, setQuickSheetOpen] = useState(false);

  const toggleQuickSheet = useCallback(() => {
    setQuickSheetOpen((prev) => !prev);
  }, []);

  const value = useMemo(
    () => ({
      hideMobileDock,
      setHideMobileDock,
      quickSheetOpen,
      setQuickSheetOpen,
      toggleQuickSheet,
    }),
    [hideMobileDock, quickSheetOpen, toggleQuickSheet],
  );

  return (
    <MobileChromeContext.Provider value={value}>
      {children}
    </MobileChromeContext.Provider>
  );
}

export function useMobileChrome() {
  return useContext(MobileChromeContext);
}
