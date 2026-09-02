import raw from "../../../data/dataset.json";
import type { Dataset } from "../types.ts";

// Static import at build time, per the task brief. The dataset may have
// _valid: false — that's expected authoring backlog, never a reason to refuse
// to load.
export const dataset = raw as unknown as Dataset;
