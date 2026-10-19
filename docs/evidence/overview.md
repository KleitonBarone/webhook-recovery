# Recovery overview

Recorded from bebc97eed1730ef01320058b8c38614b6186e691. English captions are burned into the live console recording. No voice impersonation or production traffic.

- 00:00:00,274 A signed fictional refund event enters a durable PostgreSQL inbox. Acceptance is separate from successful processing.
- 00:00:12,786 Three identical redeliveries return the original receipt. The event still has one processing attempt and one local completion.
- 00:00:25,721 Version 2 was applied before version 1 arrived. The older snapshot is recorded as stale; the completed projection stays at version 2.
- 00:00:39,823 This fictional handler keeps failing. Automatic retries have a bounded budget and preserve every attempt.
- 00:00:55,404 The operator repairs the demo cause, then requests replay with a reason. Repair alone does not rewrite or restart the accepted event.
- 00:01:02,975 Replay succeeded in a new processing cycle. The original receipt and bytes are unchanged, all three failures remain, and exactly one local completion exists.
