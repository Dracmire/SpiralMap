import type { Dataset, AttributeId } from "../types.ts";
import { useBuildState, useBuildDispatch } from "../state/buildState.ts";

const ATTRIBUTES: AttributeId[] = ["STR", "AGI", "INT", "PER", "WIL", "CHA"];

export function CharacterPanel({ dataset }: { dataset: Dataset }) {
  const build = useBuildState();
  const dispatch = useBuildDispatch();

  const sortedSkills = [...dataset.skills].sort((a, b) => a.name.localeCompare(b.name));
  const coreGroups = [...dataset.skill_groups].filter((g) => g.kind === "CORE").sort((a, b) => a.name.localeCompare(b.name));
  const supportGroups = [...dataset.skill_groups].filter((g) => g.kind === "SUPPORT").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="panel character-panel">
      <h2>Character</h2>

      <section>
        <h3>Skill Group</h3>
        <p className="hint">
          The ~25% skill CP discount only applies to skills inside a declared group. Skills outside
          every declared group are loose purchases at full price.
        </p>
        {dataset.skill_groups.length === 0 && <p className="hint">No skill groups authored yet.</p>}
        {coreGroups.length > 0 && (
          <>
            <h4 className="group-kind-label">Core</h4>
            {coreGroups.map((g) => (
              <label key={g.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={build.declared_group_ids.includes(g.id)}
                  onChange={() => dispatch({ type: "TOGGLE_GROUP", groupId: g.id })}
                />
                {g.name}
              </label>
            ))}
          </>
        )}
        {supportGroups.length > 0 && (
          <>
            <h4 className="group-kind-label">Support</h4>
            {supportGroups.map((g) => (
              <label key={g.id} className="checkbox-row">
                <input
                  type="checkbox"
                  checked={build.declared_group_ids.includes(g.id)}
                  onChange={() => dispatch({ type: "TOGGLE_GROUP", groupId: g.id })}
                />
                {g.name}
              </label>
            ))}
          </>
        )}
      </section>

      <section>
        <h3>Class</h3>
        <select
          value={build.class_id ?? ""}
          onChange={(e) => dispatch({ type: "SET_CLASS", classId: e.target.value || null })}
        >
          <option value="">None</option>
          {dataset.classes.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {dataset.classes.length === 0 && <p className="hint">No classes authored yet.</p>}
      </section>

      <section>
        <h3>Attributes</h3>
        <div className="attribute-grid">
          {ATTRIBUTES.map((attr) => (
            <label key={attr}>
              {attr}
              <input
                type="number"
                min={0}
                max={500}
                value={build.attributes[attr] ?? 0}
                onChange={(e) => dispatch({ type: "SET_ATTRIBUTE", attr, value: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3>Traits</h3>
        {dataset.traits.length === 0 && <p className="hint">No traits authored yet.</p>}
        {dataset.traits.map((t) => (
          <label key={t.id} className="checkbox-row">
            <input
              type="checkbox"
              checked={build.trait_ids.includes(t.id)}
              onChange={() => dispatch({ type: "TOGGLE_TRAIT", traitId: t.id })}
            />
            {t.name}
          </label>
        ))}
      </section>

      <section className="skills-section">
        <h3>Skill Levels</h3>
        <div className="skill-list">
          {sortedSkills.map((s) => (
            <label key={s.id} className="skill-row">
              <span>{s.name}</span>
              <input
                type="number"
                min={0}
                max={50}
                value={build.skill_levels[s.id] ?? 0}
                onChange={(e) => dispatch({ type: "SET_SKILL_LEVEL", skillId: s.id, level: Number(e.target.value) })}
              />
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
