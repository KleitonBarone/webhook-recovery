const initialCounters = () => ({
  accepted: 0,
  duplicate: 0,
  conflicting: 0,
  processed: 0,
  retry_scheduled: 0,
  ignored_stale: 0,
  dead_lettered: 0,
  lost_lease: 0,
  replay_requested: 0,
  replay_duplicate: 0,
});
type Observation = keyof ReturnType<typeof initialCounters> | "attempt_claimed";
type Correlation = {
  sourceId?: string | undefined;
  inboxId?: string | undefined;
  eventId?: string | undefined;
  attemptId?: string | null | undefined;
  replayId?: string | null | undefined;
  workerId?: string | undefined;
  cycleNumber?: number | undefined;
  cycleAttempt?: number | undefined;
};

// Fixed keys bound memory use. Correlation IDs are log fields, never counter labels.
export function createObserver(write: (line: string) => void) {
  const counters = initialCounters();
  const startedAt = new Date().toISOString();
  return (event: Observation, correlation: Correlation) => {
    if (event !== "attempt_claimed")
      counters[event] = Math.min(Number.MAX_SAFE_INTEGER, counters[event] + 1);
    write(
      JSON.stringify({
        event,
        time: new Date().toISOString(),
        pid: process.pid,
        startedAt,
        sourceId: correlation.sourceId,
        inboxId: correlation.inboxId,
        eventId: correlation.eventId,
        attemptId: correlation.attemptId,
        replayId: correlation.replayId,
        workerId: correlation.workerId,
        cycleNumber: correlation.cycleNumber,
        cycleAttempt: correlation.cycleAttempt,
        counters: { ...counters },
      }),
    );
  };
}
export const observe = createObserver((line) => console.log(line));

// Error messages may contain SQL, parameters, raw payloads, or config credentials.
export function diagnostic(error: unknown) {
  const controlled = new Set([
    "Injected startup failure",
    "Injected test failure",
    "Verification interrupted",
    "Injected crash-barrier failure",
    "Injected browser failure",
  ]);
  if (error instanceof Error && controlled.has(error.message)) return error.message;
  const names = new Set([
    "Error",
    "TypeError",
    "SyntaxError",
    "RangeError",
    "ReferenceError",
    "URIError",
    "EvalError",
    "AggregateError",
    "AssertionError",
    "PostgresError",
    "DrizzleQueryError",
  ]);
  const name = error instanceof Error && names.has(error.name) ? error.name : "Error";
  const cause = error instanceof Error && error.cause ? error.cause : error;
  const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
  return typeof code === "string" && /^[A-Z0-9_]{1,10}$/.test(code) ? `${name} (${code})` : name;
}
