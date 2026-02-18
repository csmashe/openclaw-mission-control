"use client";

import { useCallback, useEffect, useRef } from "react";

interface UseAdaptivePollingOptions {
  poll: () => Promise<void>;
  intervalMs: number;
  /**
   * Poll interval while tab is hidden.
   * - null: pause polling while hidden
   * - number: continue polling at reduced cadence
   */
  hiddenIntervalMs?: number | null;
  maxBackoffMs?: number;
  backoffMultiplier?: number;
  jitterRatio?: number;
  enabled?: boolean;
}

export function useAdaptivePolling({
  poll,
  intervalMs,
  hiddenIntervalMs = null,
  maxBackoffMs = 60_000,
  backoffMultiplier = 2,
  jitterRatio = 0.2,
  enabled = true,
}: UseAdaptivePollingOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);
  const errorCountRef = useRef(0);
  const pollRef = useRef(poll);
  const runTickRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const getDelayMs = useCallback((): number | null => {
    const hidden = typeof document !== "undefined" && document.hidden;
    const baseInterval = hidden ? hiddenIntervalMs : intervalMs;

    if (baseInterval == null) return null;

    const attempts = errorCountRef.current;
    const backedOff =
      attempts > 0
        ? Math.min(baseInterval * backoffMultiplier ** (attempts - 1), maxBackoffMs)
        : baseInterval;

    const jitterSpan = backedOff * jitterRatio;
    const jittered =
      jitterSpan > 0
        ? backedOff + (Math.random() * 2 - 1) * jitterSpan
        : backedOff;

    return Math.max(0, Math.round(jittered));
  }, [backoffMultiplier, hiddenIntervalMs, intervalMs, jitterRatio, maxBackoffMs]);

  const scheduleNext = useCallback(
    (overrideDelayMs?: number) => {
      clearTimer();

      if (!enabled) return;

      const delay =
        overrideDelayMs !== undefined ? overrideDelayMs : getDelayMs();

      if (delay == null) return;

      timerRef.current = setTimeout(() => {
        void runTickRef.current();
      }, delay);
    },
    [clearTimer, enabled, getDelayMs]
  );

  const runTick = useCallback(async () => {
    if (!enabled) return;

    if (inFlightRef.current) {
      scheduleNext();
      return;
    }

    inFlightRef.current = true;

    try {
      await pollRef.current();
      errorCountRef.current = 0;
    } catch {
      errorCountRef.current += 1;
    } finally {
      inFlightRef.current = false;
      scheduleNext();
    }
  }, [enabled, scheduleNext]);

  useEffect(() => {
    runTickRef.current = runTick;
  }, [runTick]);

  const refreshNow = useCallback(() => {
    if (!enabled) return;

    errorCountRef.current = 0;
    clearTimer();
    void runTickRef.current();
  }, [clearTimer, enabled]);

  useEffect(() => {
    if (!enabled) {
      clearTimer();
      return;
    }

    refreshNow();

    return () => {
      clearTimer();
    };
  }, [clearTimer, enabled, refreshNow]);

  useEffect(() => {
    if (!enabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden && hiddenIntervalMs == null) {
        clearTimer();
        return;
      }

      if (!document.hidden) {
        refreshNow();
      }
    };

    const handleFocus = () => {
      refreshNow();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
      clearTimer();
    };
  }, [clearTimer, enabled, hiddenIntervalMs, refreshNow]);
}
