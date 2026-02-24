"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { CheckCircle, Lock, AlertCircle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PlanningOption {
  id: string;
  label: string;
}

interface PlanningQuestion {
  question: string;
  options: PlanningOption[];
}

interface PlanningMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

interface PlanningState {
  taskId: string;
  sessionKey?: string;
  messages: PlanningMessage[];
  currentQuestion?: PlanningQuestion;
  isComplete: boolean;
  dispatchError?: string;
  spec?: {
    title: string;
    summary: string;
    deliverables: string[];
    success_criteria: string[];
  };
  agents?: Array<{
    name: string;
    role: string;
    avatar_emoji: string;
  }>;
  isStarted: boolean;
}

interface PlanningTabProps {
  taskId: string;
  onSpecLocked?: () => void;
}

export function PlanningTab({ taskId, onSpecLocked }: PlanningTabProps) {
  const [state, setState] = useState<PlanningState | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otherText, setOtherText] = useState("");
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isWaitingForResponse, setIsWaitingForResponse] = useState(false);
  const [retryingDispatch, setRetryingDispatch] = useState(false);
  const [isSubmittingAnswer, setIsSubmittingAnswer] = useState(false);

  const pollingIntervalRef = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const pollingTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isPollingRef = useRef(false);
  const lastSubmissionRef = useRef<{ answer: string; otherText?: string } | null>(null);
  const currentQuestionRef = useRef<string | undefined>(undefined);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/planning`);
      if (res.ok) {
        const data = await res.json();
        setState(data);
        currentQuestionRef.current = data.currentQuestion?.question;
      }
    } catch (err) {
      console.error("Failed to load planning state:", err);
      setError("Failed to load planning state");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = undefined;
    }
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = undefined;
    }
    setIsWaitingForResponse(false);
  }, []);

  const pollForUpdates = useCallback(async () => {
    if (isPollingRef.current) return;
    isPollingRef.current = true;

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning/poll`);
      if (res.ok) {
        const data = await res.json();

        if (data.hasUpdates) {
          const newQuestion = data.currentQuestion?.question;
          const questionChanged = newQuestion && currentQuestionRef.current !== newQuestion;

          const freshRes = await fetch(`/api/tasks/${taskId}/planning`);
          if (freshRes.ok) {
            const freshData = await freshRes.json();
            setState(freshData);
          } else {
            setState((prev) => ({
              ...prev!,
              messages: data.messages,
              isComplete: data.complete,
              spec: data.spec,
              agents: data.agents,
              currentQuestion: data.currentQuestion,
              dispatchError: data.dispatchError,
            }));
          }

          if (questionChanged) {
            currentQuestionRef.current = newQuestion;
            setSelectedOption(null);
            setOtherText("");
            setIsSubmittingAnswer(false);
          }
          if (data.currentQuestion) {
            setIsSubmittingAnswer(false);
            setSubmitting(false);
          }

          if (data.dispatchError) {
            setError(`Planning completed but dispatch failed: ${data.dispatchError}`);
          }

          if (data.complete && onSpecLocked) {
            onSpecLocked();
          }

          if (data.currentQuestion || data.complete || data.dispatchError) {
            setIsWaitingForResponse(false);
            stopPolling();
          }
        }
      }
    } catch (err) {
      console.error("Failed to poll for updates:", err);
    } finally {
      isPollingRef.current = false;
    }
  }, [taskId, onSpecLocked, stopPolling]);

  const startPolling = useCallback(() => {
    stopPolling();
    setIsWaitingForResponse(true);

    pollingIntervalRef.current = setInterval(() => {
      pollForUpdates();
    }, 2000);

    pollingTimeoutRef.current = setTimeout(() => {
      stopPolling();
      setSubmitting(false);
      setIsSubmittingAnswer(false);
      setError("The orchestrator is taking too long to respond. Please try submitting again or refresh the page.");
    }, 90000);
  }, [pollForUpdates, stopPolling]);

  useEffect(() => {
    if (state?.currentQuestion) {
      currentQuestionRef.current = state.currentQuestion.question;
    }
  }, [state]);

  useEffect(() => {
    loadState();
    return () => stopPolling();
  }, [loadState, stopPolling]);

  useEffect(() => {
    if (state && state.isStarted && !state.isComplete && !state.currentQuestion && !isWaitingForResponse) {
      startPolling();
    }
  }, [state, isWaitingForResponse, startPolling]);

  const startPlanning = async () => {
    setStarting(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning`, { method: "POST" });
      const data = await res.json();

      if (res.ok) {
        setState((prev) => ({
          ...prev!,
          sessionKey: data.sessionKey,
          messages: data.messages || [],
          isStarted: true,
        }));
        startPolling();
      } else {
        setError(data.error || "Failed to start planning");
      }
    } catch {
      setError("Failed to start planning");
    } finally {
      setStarting(false);
    }
  };

  const submitAnswer = async () => {
    if (!selectedOption) return;

    setSubmitting(true);
    setIsSubmittingAnswer(true);
    setError(null);

    const submission = {
      answer: selectedOption?.toLowerCase() === "other" ? "other" : selectedOption,
      otherText: selectedOption?.toLowerCase() === "other" ? otherText : undefined,
    };
    lastSubmissionRef.current = submission;

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });

      const data = await res.json();

      if (res.ok) {
        startPolling();
      } else {
        setError(data.error || "Failed to submit answer");
        setIsSubmittingAnswer(false);
        setSelectedOption(null);
        setOtherText("");
      }
    } catch {
      setError("Failed to submit answer");
      setIsSubmittingAnswer(false);
      setSelectedOption(null);
      setOtherText("");
    }
  };

  const handleRetry = async () => {
    const submission = lastSubmissionRef.current;
    if (!submission) return;

    setSubmitting(true);
    setIsSubmittingAnswer(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(submission),
      });

      const data = await res.json();

      if (res.ok) {
        startPolling();
      } else {
        setError(data.error || "Failed to submit answer");
        setIsSubmittingAnswer(false);
        setSelectedOption(null);
        setOtherText("");
      }
    } catch {
      setError("Failed to submit answer");
      setIsSubmittingAnswer(false);
      setSelectedOption(null);
      setOtherText("");
    } finally {
      setSubmitting(false);
    }
  };

  const retryDispatch = async () => {
    setRetryingDispatch(true);
    setError(null);

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning/approve`, {
        method: "POST",
      });

      const data = await res.json();

      if (res.ok) {
        setError(null);
        // Reload state to reflect dispatch success
        await loadState();
      } else {
        setError(`Failed to retry dispatch: ${data.error}`);
      }
    } catch {
      setError("Failed to retry dispatch");
    } finally {
      setRetryingDispatch(false);
    }
  };

  const cancelPlanning = async () => {
    if (!confirm("Are you sure you want to cancel planning? This will reset the planning state.")) {
      return;
    }

    setCanceling(true);
    setError(null);
    setIsSubmittingAnswer(false);
    stopPolling();

    try {
      const res = await fetch(`/api/tasks/${taskId}/planning`, {
        method: "DELETE",
      });

      if (res.ok) {
        setState({
          taskId,
          isStarted: false,
          messages: [],
          isComplete: false,
        });
      } else {
        const data = await res.json();
        setError(data.error || "Failed to cancel planning");
      }
    } catch {
      setError("Failed to cancel planning");
    } finally {
      setCanceling(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">Loading planning state...</span>
      </div>
    );
  }

  // Planning complete - show spec
  if (state?.isComplete && state?.spec) {
    return (
      <div className="p-4 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-green-500">
            <Lock className="w-5 h-5" />
            <span className="font-medium">Planning Complete</span>
          </div>
          {state.dispatchError && (
            <span className="text-sm text-amber-500">Dispatch Failed</span>
          )}
        </div>

        {state.dispatchError && (
          <div className="p-4 rounded-md bg-amber-500/10 border border-amber-500/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1">
                <p className="text-amber-500 text-sm font-medium mb-2">Task dispatch failed</p>
                <p className="text-amber-400 text-xs mb-3">{state.dispatchError}</p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={retryDispatch}
                  disabled={retryingDispatch}
                  className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                >
                  {retryingDispatch ? (
                    <><Loader2 className="w-3 h-3 animate-spin mr-1" /> Retrying...</>
                  ) : (
                    <><CheckCircle className="w-3 h-3 mr-1" /> Retry Dispatch</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="p-4 rounded-md bg-muted border border-border">
          <h3 className="font-medium mb-2">{state.spec.title}</h3>
          <p className="text-sm text-muted-foreground mb-4">{state.spec.summary}</p>

          {state.spec.deliverables?.length > 0 && (
            <div className="mb-3">
              <h4 className="text-sm font-medium mb-1">Deliverables:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground">
                {state.spec.deliverables.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </div>
          )}

          {state.spec.success_criteria?.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-1">Success Criteria:</h4>
              <ul className="list-disc list-inside text-sm text-muted-foreground">
                {state.spec.success_criteria.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {state.agents && state.agents.length > 0 && (
          <div>
            <h3 className="font-medium mb-2">Agents Created:</h3>
            <div className="space-y-2">
              {state.agents.map((agent, i) => (
                <div key={i} className="p-3 rounded-md bg-muted border border-border flex items-center gap-3">
                  <span className="text-2xl">{agent.avatar_emoji}</span>
                  <div>
                    <p className="font-medium">{agent.name}</p>
                    <p className="text-sm text-muted-foreground">{agent.role}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // Not started - show start button
  if (!state?.isStarted) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-medium mb-2">Start Planning</h3>
          <p className="text-muted-foreground text-sm max-w-md">
            The planner will review the task and create a specification.
            It may ask clarifying questions if needed.
          </p>
        </div>

        {error && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        <Button onClick={startPlanning} disabled={starting} size="lg">
          {starting ? (
            <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Starting...</>
          ) : (
            "Start Planning"
          )}
        </Button>
      </div>
    );
  }

  // Show current question
  return (
    <div className="flex flex-col h-full">
      {/* Progress indicator with cancel button */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
          <span>Planning in progress...</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={cancelPlanning}
          disabled={canceling}
          className="text-destructive hover:bg-destructive/10"
        >
          {canceling ? (
            <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Canceling...</>
          ) : (
            <><X className="w-4 h-4 mr-1" /> Cancel</>
          )}
        </Button>
      </div>

      {/* Question area */}
      <div className="flex-1 overflow-y-auto p-6">
        {state?.currentQuestion ? (
          <div className="max-w-xl mx-auto">
            <h3 className="text-lg font-medium mb-6">
              {state.currentQuestion.question}
            </h3>

            <div className="space-y-3">
              {state.currentQuestion.options.map((option) => {
                const isSelected = selectedOption === option.label;
                const isOther = option.id === "other" || option.label.toLowerCase() === "other";
                const isThisOptionSubmitting = isSubmittingAnswer && isSelected;

                return (
                  <div key={option.id}>
                    <button
                      onClick={() => setSelectedOption(option.label)}
                      disabled={submitting}
                      className={`w-full flex items-center gap-3 p-4 rounded-lg border transition-all text-left ${
                        isThisOptionSubmitting
                          ? "border-primary bg-primary/20"
                          : isSelected
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50"
                      } disabled:opacity-50`}
                    >
                      <span className={`w-8 h-8 rounded flex items-center justify-center text-sm font-bold ${
                        isSelected ? "bg-primary text-primary-foreground" : "bg-muted"
                      }`}>
                        {option.id.toUpperCase()}
                      </span>
                      <span className="flex-1">{option.label}</span>
                      {isThisOptionSubmitting ? (
                        <Loader2 className="w-5 h-5 text-primary animate-spin" />
                      ) : isSelected && !submitting ? (
                        <CheckCircle className="w-5 h-5 text-primary" />
                      ) : null}
                    </button>

                    {isOther && isSelected && (
                      <div className="mt-2 ml-11">
                        <input
                          type="text"
                          value={otherText}
                          onChange={(e) => setOtherText(e.target.value)}
                          placeholder="Please specify..."
                          className="w-full px-3 py-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                          disabled={submitting}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {error && (
              <div className="mt-4 p-3 rounded-md bg-destructive/10 border border-destructive/30">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-destructive text-sm">{error}</p>
                    {!isWaitingForResponse && lastSubmissionRef.current && (
                      <button
                        onClick={handleRetry}
                        disabled={submitting}
                        className="mt-2 text-xs text-destructive hover:text-destructive/80 underline disabled:opacity-50"
                      >
                        {submitting ? "Retrying..." : "Retry"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div className="mt-6">
              <Button
                onClick={submitAnswer}
                disabled={!selectedOption || submitting || (selectedOption === "Other" && !otherText.trim())}
                className="w-full"
                size="lg"
              >
                {submitting ? (
                  <><Loader2 className="w-5 h-5 animate-spin mr-2" /> Sending...</>
                ) : (
                  "Continue"
                )}
              </Button>

              {isSubmittingAnswer && !submitting && (
                <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                  <span>Waiting for response...</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto mb-2" />
              <p className="text-muted-foreground">
                {isWaitingForResponse ? "Waiting for response..." : "Waiting for next question..."}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Conversation history (collapsed) */}
      {state?.messages && state.messages.length > 0 && (
        <details className="border-t border-border">
          <summary className="p-3 text-sm text-muted-foreground cursor-pointer hover:bg-muted">
            View conversation ({state.messages.length} messages)
          </summary>
          <div className="p-3 space-y-2 max-h-48 overflow-y-auto bg-muted">
            {state.messages.map((msg, i) => (
              <div key={i} className={`text-sm ${msg.role === "user" ? "text-primary" : "text-muted-foreground"}`}>
                <span className="font-medium">{msg.role === "user" ? "You" : "Orchestrator"}:</span>{" "}
                <span className="opacity-75">{msg.content.substring(0, 100)}...</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
