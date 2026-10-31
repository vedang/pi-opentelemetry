import { randomUUID } from "node:crypto";
import { type Attributes, ROOT_CONTEXT, type Span } from "@opentelemetry/api";
import type { Telemetry } from "./telemetry.ts";

type Outcome = "success" | "error" | "aborted" | "incomplete";
type Owner = { id: string; start: number; span?: Span };
type Work = Owner & { outcome: Outcome };

/** Bounded live ancestry: one activity, run and turn. Never retain completed IDs. */
export class Correlation {
  private activity?: Owner & {
    messageType: "user" | "custom";
    hadError: boolean;
  };
  private run?: Work;
  private turn?: Work & { index: number };
  private readonly activities;
  private readonly activityDuration;
  private readonly turns;
  private readonly turnDuration;
  private readonly runs;
  private readonly runDuration;

  private readonly telemetry: Telemetry;
  private readonly sessionId: string;
  private readonly interrupt: () => void;

  constructor(telemetry: Telemetry, sessionId: string, interrupt: () => void) {
    this.telemetry = telemetry;
    this.sessionId = sessionId;
    this.interrupt = interrupt;
    const meter = telemetry.meter;
    this.activities = meter.createCounter("pi.activity.count");
    this.activityDuration = meter.createHistogram("pi.activity.duration", {
      unit: "s",
    });
    this.turns = meter.createCounter("pi.turn.count");
    this.turnDuration = meter.createHistogram("pi.turn.duration", {
      unit: "s",
    });
    this.runs = meter.createCounter("pi.run.count");
    this.runDuration = meter.createHistogram("pi.run.duration", { unit: "s" });
  }

  base(): Attributes {
    return {
      "session.id": this.sessionId,
      "pi.scope": this.turn
        ? "turn"
        : this.run
          ? "run"
          : this.activity
            ? "activity"
            : "standalone",
      ...(this.activity ? { "pi.activity.id": this.activity.id } : {}),
      ...(this.run ? { "pi.run.id": this.run.id } : {}),
      ...(this.turn
        ? { "pi.turn.id": this.turn.id, "pi.turn.index": this.turn.index }
        : {}),
    };
  }

  parent(): Span | undefined {
    return this.turn?.span ?? this.run?.span ?? this.activity?.span;
  }

  observe(outcome: Outcome) {
    if (outcome === "error" && this.activity) this.activity.hadError = true;
    // Preserve the existing run contract: a later success cannot erase failure.
    if (outcome !== "success") {
      if (this.run) this.run.outcome = outcome;
      if (this.turn) this.turn.outcome = outcome;
    }
  }

  incomplete() {
    if (this.run?.outcome === "success") this.run.outcome = "incomplete";
    if (this.turn?.outcome === "success") this.turn.outcome = "incomplete";
    this.telemetry.lost();
  }

  startActivity(messageType: "user" | "custom") {
    this.endActivity("incomplete");
    const id = randomUUID();
    this.activity = {
      id,
      start: performance.now(),
      messageType,
      hadError: false,
    };
    const attrs = { ...this.base(), "pi.message_type": messageType };
    this.activity.span = this.telemetry.start("pi.activity", attrs);
    this.telemetry.emit("pi.activity_start", attrs, this.activity.span);
  }

  startRun() {
    this.endRun("incomplete");
    this.run = {
      id: randomUUID(),
      start: performance.now(),
      outcome: "success",
    };
    this.run.span = this.telemetry.start(
      "pi.agent_run",
      this.base(),
      this.activity?.span,
    );
    this.telemetry.emit("pi.run_start", this.base(), this.run.span);
  }

  startTurn(index: number) {
    this.endTurn("incomplete");
    if (!Number.isSafeInteger(index) || index < 0) {
      this.incomplete();
      return;
    }
    this.turn = {
      id: randomUUID(),
      index,
      start: performance.now(),
      outcome: "success",
    };
    this.turn.span = this.telemetry.start(
      "pi.turn",
      this.base(),
      this.run?.span ?? this.activity?.span,
    );
    this.telemetry.emit("pi.turn_start", this.base(), this.turn.span);
  }

  endTurn(outcome?: Outcome, index?: number) {
    this.interrupt();
    const turn = this.turn;
    if (!turn) {
      if (index !== undefined) this.unmatched("pi.turn_end");
      return;
    }
    const complete =
      outcome !== "incomplete" && (index === undefined || index === turn.index);
    const final = complete
      ? outcome && outcome !== "success"
        ? outcome
        : turn.outcome
      : "incomplete";
    this.observe(final);
    const attrs: Attributes = { ...this.base(), "pi.outcome": final };
    this.turns.add(1, { outcome: final }, ROOT_CONTEXT);
    if (complete) {
      const elapsed = performance.now() - turn.start;
      attrs["pi.duration_ms"] = elapsed;
      attrs["timing.source"] = "turn_lifecycle";
      this.turnDuration.record(
        elapsed / 1000,
        { outcome: final },
        ROOT_CONTEXT,
      );
    } else this.telemetry.lost();
    this.telemetry.emit("pi.turn_end", attrs, turn.span);
    this.telemetry.finish(turn.span, attrs, final);
    this.turn = undefined;
  }

  endRun(outcome?: "aborted" | "incomplete") {
    this.endTurn("incomplete");
    const run = this.run;
    if (!run) return;
    const final = outcome ?? run.outcome;
    const attrs: Attributes = { ...this.base(), "pi.outcome": final };
    this.runs.add(1, { outcome: final }, ROOT_CONTEXT);
    if (outcome !== "incomplete") {
      const elapsed = performance.now() - run.start;
      attrs["pi.duration_ms"] = elapsed;
      attrs["timing.source"] = "agent_lifecycle";
      this.runDuration.record(elapsed / 1000, { outcome: final }, ROOT_CONTEXT);
    } else this.telemetry.lost();
    this.telemetry.emit("pi.run_end", attrs, run.span);
    this.telemetry.finish(run.span, attrs, final);
    this.run = undefined;
  }

  endActivity(outcome: "settled" | "incomplete", aborted?: boolean) {
    this.endRun("incomplete");
    const activity = this.activity;
    if (!activity) {
      if (outcome === "settled") this.unmatched("pi.activity_end", aborted);
      return;
    }
    const dimensions = {
      outcome,
      had_error: activity.hadError,
      ...(aborted === undefined ? {} : { aborted }),
    };
    const attrs: Attributes = {
      ...this.base(),
      "pi.outcome": outcome,
      "pi.message_type": activity.messageType,
      "pi.had_error": activity.hadError,
      ...(aborted === undefined ? {} : { "pi.aborted": aborted }),
    };
    this.activities.add(1, dimensions, ROOT_CONTEXT);
    if (outcome === "settled") {
      const elapsed = performance.now() - activity.start;
      attrs["pi.duration_ms"] = elapsed;
      attrs["timing.source"] = "activity_lifecycle";
      this.activityDuration.record(elapsed / 1000, dimensions, ROOT_CONTEXT);
    } else this.telemetry.lost();
    this.telemetry.emit("pi.activity_end", attrs, activity.span);
    this.telemetry.finish(activity.span, attrs, outcome);
    this.activity = undefined;
  }

  private unmatched(name: string, aborted?: boolean) {
    this.telemetry.lost();
    this.telemetry.emit(
      name,
      {
        ...this.base(),
        "pi.outcome": "incomplete",
        "pi.start_missing": true,
        ...(aborted === undefined ? {} : { "pi.aborted": aborted }),
      },
      this.parent(),
    );
  }
}
