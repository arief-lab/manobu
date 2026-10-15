import {
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export const EXAM_CHAT_COLLAPSE_STORAGE_KEY = "manobu:exam-chat-collapse:v1";

interface StoredCollapse {
  collapsed: boolean;
  version: 1;
}

export const isNarrowExamScreen = (): boolean => {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    if (typeof window.matchMedia === "function") {
      return window.matchMedia("(max-width: 1023px)").matches;
    }
  } catch {
    return typeof window.innerWidth === "number"
      ? window.innerWidth < 1024
      : true;
  }
  return typeof window.innerWidth === "number"
    ? window.innerWidth < 1024
    : true;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredCollapse = (raw: string | null): boolean | null => {
  if (raw === null) {
    return null;
  }
  if (raw === "1") {
    return true;
  }
  if (raw === "0") {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed === "boolean") {
    return parsed;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    return null;
  }
  return typeof parsed.collapsed === "boolean" ? parsed.collapsed : null;
};

export const parseExamChatCollapse = (
  raw: string | null,
  fallback = isNarrowExamScreen()
): boolean => parseStoredCollapse(raw) ?? fallback;

const persistCollapse = (collapsed: boolean): boolean => {
  try {
    const stored: StoredCollapse = { collapsed, version: 1 };
    window.localStorage.setItem(
      EXAM_CHAT_COLLAPSE_STORAGE_KEY,
      JSON.stringify(stored)
    );
    return true;
  } catch {
    return false;
  }
};

const readCollapsePreference = (): {
  collapsed: boolean;
  explicit: boolean;
} => {
  const fallback = isNarrowExamScreen();
  if (typeof window === "undefined") {
    return { collapsed: fallback, explicit: false };
  }
  try {
    const raw = window.localStorage.getItem(EXAM_CHAT_COLLAPSE_STORAGE_KEY);
    const parsed = parseStoredCollapse(raw);
    return {
      collapsed: parsed ?? fallback,
      explicit: parsed !== null,
    };
  } catch {
    return { collapsed: fallback, explicit: false };
  }
};

export function useExamChatCollapse(): readonly [
  boolean,
  (value: SetStateAction<boolean>) => void,
] {
  const initial = useRef<ReturnType<typeof readCollapsePreference> | null>(
    null
  );
  if (initial.current === null) {
    initial.current = readCollapsePreference();
  }
  const [collapsed, setCollapsed] = useState(initial.current.collapsed);
  const collapsedRef = useRef(collapsed);
  const explicitRef = useRef(initial.current.explicit);
  collapsedRef.current = collapsed;

  const setPreference = useCallback((value: SetStateAction<boolean>) => {
    const next =
      typeof value === "function" ? value(collapsedRef.current) : value;
    collapsedRef.current = next;
    explicitRef.current = true;
    setCollapsed(next);
    persistCollapse(next);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const updateDefault = () => {
      if (explicitRef.current) {
        return;
      }
      const next = isNarrowExamScreen();
      collapsedRef.current = next;
      setCollapsed(next);
    };
    let media: MediaQueryList | null = null;
    if (typeof window.matchMedia === "function") {
      try {
        media = window.matchMedia("(max-width: 1023px)");
      } catch {
        media = null;
      }
    }
    if (media?.addEventListener) {
      media.addEventListener("change", updateDefault);
      return () => media?.removeEventListener("change", updateDefault);
    }
    window.addEventListener("resize", updateDefault);
    return () => window.removeEventListener("resize", updateDefault);
  }, []);

  return [collapsed, setPreference] as const;
}
