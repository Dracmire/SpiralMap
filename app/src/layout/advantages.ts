import type { Dataset, Perk } from "../types.ts";

export interface AdvantageContribution {
  perk_id: string;
  perk_name: string;
  bonus_type: string | null;
  value: number;
}

export interface AdvantageRow {
  subject: string;
  category: string;
  contributions: AdvantageContribution[];
  total: number;
}

export interface AdvantagesResult {
  rows: AdvantageRow[];
  unclassified: Perk[];
}

function ladderValue(dataset: Dataset, perk: Perk): number {
  if (!perk.family || !perk.tier) return 0;
  const step = dataset.effect_ladder.find((s) => s.family === perk.family && s.tier === perk.tier);
  return step?.numeric_value ?? 0;
}

/**
 * Compound-advantages panel: group owned perks by (subject, bonus_type), keep
 * only the max within each group, then sum across bonus_types sharing a
 * subject, partitioned by bonus_category. Perks with blank subject or family
 * go to `unclassified` instead of being silently dropped.
 */
export function computeAdvantages(ownedPerks: Perk[], dataset: Dataset): AdvantagesResult {
  const unclassified: Perk[] = [];
  const classified = ownedPerks.filter((p) => {
    if (!p.subject || !p.family) {
      unclassified.push(p);
      return false;
    }
    return true;
  });

  // group by (subject, bonus_type) -> max value contribution
  const byGroup = new Map<string, { subject: string; bonus_type: string | null; category: string; best: AdvantageContribution }>();
  for (const perk of classified) {
    const category = perk.bonus_category ?? "UNCATEGORIZED";
    const key = `${perk.subject}|${perk.bonus_type ?? "NONE"}`;
    const value = ladderValue(dataset, perk);
    const existing = byGroup.get(key);
    if (!existing || value > existing.best.value) {
      byGroup.set(key, {
        subject: perk.subject,
        bonus_type: perk.bonus_type,
        category,
        best: { perk_id: perk.id, perk_name: perk.name, bonus_type: perk.bonus_type, value },
      });
    }
  }

  // sum across bonus_types sharing the same (subject, category)
  const bySubjectCategory = new Map<string, AdvantageRow>();
  for (const { subject, category, best } of byGroup.values()) {
    const key = `${subject}|${category}`;
    const row = bySubjectCategory.get(key) ?? { subject, category, contributions: [], total: 0 };
    row.contributions.push(best);
    row.total += best.value;
    bySubjectCategory.set(key, row);
  }

  return { rows: [...bySubjectCategory.values()].sort((a, b) => a.subject.localeCompare(b.subject)), unclassified };
}
