import type {
  SpiralDataset,
  Perk as SchemaPerk,
  Feat as SchemaFeat,
  Fusion as SchemaFusion,
  AttributeId,
  Requirement,
  LadderClass,
} from "../../schema/spiral.ts";

export type { AttributeId, Requirement, LadderClass };

/** perks.csv/legacy_perks.csv carry these as non-schema passthrough — never validated. */
export type Perk = SchemaPerk & { subject_suggested?: string; family_suggested?: string };

/** legacy_feats.csv carries these as non-schema passthrough provenance — never validated. */
export type Feat = SchemaFeat & { skill_group?: string; block?: string };
export type Fusion = SchemaFusion & { skill_group?: string; block?: string };

export type FeatOrFusion = Feat | Fusion;

export function isFusion(f: FeatOrFusion): f is Fusion {
  return "operator" in f;
}

export type Dataset = Omit<SpiralDataset, "perks" | "feats" | "fusions"> & {
  perks: Perk[];
  feats: Feat[];
  fusions: Fusion[];
  _valid: boolean;
  _draft?: boolean;
  _error_count: number;
  _warning_count: number;
};
