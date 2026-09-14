import { mkdir } from "node:fs/promises";
import { citedEvidence, type AgentViewport, type Choice, type Reflection } from "./agent";
import { render } from "./render";
import type { Node, Timing } from "./page/page";

export type CalibrationRecord = ReturnType<typeof makeCalibrationRecord>;

export function makeCalibrationRecord(opts: {
  url: string;
  goal: string;
  model: string;
  viewport: AgentViewport;
  before: Node[];
  choices: Choice[];
  selectedAction: { choice: Choice; node: Node; timing: Timing };
  after: Node[];
  reflections: Reflection[];
}) {
  return {
    schemaVersion: 1 as const,
    capturedAt: new Date().toISOString(),
    url: opts.url,
    goal: opts.goal,
    model: opts.model,
    viewport: opts.viewport,
    runs: opts.choices.length,
    beforeSnapshot: render(opts.before),
    choices: opts.choices,
    selectedAction: {
      choice: opts.selectedAction.choice,
      node: {
        ref: opts.selectedAction.node.ref,
        role: opts.selectedAction.node.role,
        name: opts.selectedAction.node.name,
      },
      timing: opts.selectedAction.timing,
    },
    afterSnapshot: render(opts.after),
    reflections: opts.reflections.map((reflection) => ({
      ...reflection,
      citedEvidence: citedEvidence(reflection, opts.after),
    })),
  };
}

export async function saveCalibration(record: CalibrationRecord, dir = "out/calibrations") {
  await mkdir(dir, { recursive: true });
  const stamp = record.capturedAt.replace(/[:.]/g, "-");
  const file = `${dir}/${stamp}-${crypto.randomUUID().slice(0, 8)}.json`;
  await Bun.write(file, JSON.stringify(record, null, 2) + "\n");
  return file;
}
