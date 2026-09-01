import { createContext, useContext, useReducer, type Dispatch } from "react";
import type { BuildState, AttributeId } from "../../../schema/spiral.ts";

export function emptyBuildState(): BuildState {
  return {
    zone_id: "universal",
    skill_levels: {},
    attributes: { STR: 100, AGI: 100, INT: 100, PER: 100, WIL: 100, CHA: 100 } as Record<AttributeId, number>,
    trait_ids: [],
    class_id: null,
    feat_ids: [],
    declared_group_ids: [],
  };
}

export type BuildAction =
  | { type: "SET_SKILL_LEVEL"; skillId: string; level: number }
  | { type: "SET_ATTRIBUTE"; attr: AttributeId; value: number }
  | { type: "SET_CLASS"; classId: string | null }
  | { type: "TOGGLE_TRAIT"; traitId: string }
  | { type: "TOGGLE_FEAT"; featId: string }
  | { type: "TOGGLE_GROUP"; groupId: string }
  | { type: "REPLACE_STATE"; state: BuildState };

export function buildReducer(state: BuildState, action: BuildAction): BuildState {
  switch (action.type) {
    case "SET_SKILL_LEVEL":
      return { ...state, skill_levels: { ...state.skill_levels, [action.skillId]: action.level } };
    case "SET_ATTRIBUTE":
      return { ...state, attributes: { ...state.attributes, [action.attr]: action.value } };
    case "SET_CLASS":
      return { ...state, class_id: action.classId };
    case "TOGGLE_TRAIT":
      return {
        ...state,
        trait_ids: state.trait_ids.includes(action.traitId)
          ? state.trait_ids.filter((t) => t !== action.traitId)
          : [...state.trait_ids, action.traitId],
      };
    case "TOGGLE_FEAT":
      return {
        ...state,
        feat_ids: state.feat_ids.includes(action.featId)
          ? state.feat_ids.filter((f) => f !== action.featId)
          : [...state.feat_ids, action.featId],
      };
    case "TOGGLE_GROUP":
      return {
        ...state,
        declared_group_ids: state.declared_group_ids.includes(action.groupId)
          ? state.declared_group_ids.filter((g) => g !== action.groupId)
          : [...state.declared_group_ids, action.groupId],
      };
    case "REPLACE_STATE":
      return action.state;
    default:
      return state;
  }
}

export const BuildStateContext = createContext<BuildState>(emptyBuildState());
export const BuildDispatchContext = createContext<Dispatch<BuildAction>>(() => {});

export function useBuildState() {
  return useContext(BuildStateContext);
}
export function useBuildDispatch() {
  return useContext(BuildDispatchContext);
}

export function useBuildReducer(initial: BuildState) {
  return useReducer(buildReducer, initial);
}
