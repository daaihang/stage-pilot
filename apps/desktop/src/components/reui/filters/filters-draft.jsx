export function createFilterDraft(cascaderPath = []) {
  return {
    step: "field",
    status: "editing",
    ruleId: null,
    path: [],
    cascaderPath,
    operator: null,
    value: undefined,
    query: "",
  }
}

/** null means Back closes the builder rather than stepping back. */
function previousStep(step) {
  if (step === "value") return "operator"
  if (step === "operator") return "field"
  return null
}

/**
 * `null` is the closed state, not a separate boolean: `{ open, draft }` would
 * make "open with no draft" and "closed but still holding one" representable.
 */
export function filterDraftReducer(state, action) {
  switch (action.type) {
    case "openCreate":
      return createFilterDraft(action.cascaderPath ?? []);

    case "openAmend":
      return {
        step: action.step,
        status: "editing",
        ruleId: action.ruleId,
        path: action.path,
        // Defaults the picker to the field's own level, so amend opens beside
        // its siblings, not at the root. Callers may override.
        cascaderPath: action.cascaderPath ?? action.path.slice(0, -1),
        operator: action.operator,
        value: action.value,
        query: "",
      }

    case "close":
      return null

    case "setCascaderPath":
      if (!state) return state
      if (state.cascaderPath === action.path) return state
      return { ...state, cascaderPath: action.path }

    case "setQuery":
      if (!state) return state
      if (state.query === action.query) return state
      return { ...state, query: action.query }

    case "selectField": {
      if (!state) return state
      // Choosing a field COMMITS at once; the condition is picked on the chip,
      // so the popover never holds a second and third step to walk.
      return {
        ...state,
        path: action.path,
        operator: action.defaultOperator,
        status: "ready",
        // A field change invalidates the value: "Active" means nothing once
        // the field becomes "Created at".
        value: undefined,
        step: "operator",
        query: "",
      }
    }

    case "selectOperator": {
      if (!state) return state
      // arity "none" is the whole filter; a value step would be an empty panel.
      if (action.arity === "none") {
        return {
          ...state,
          operator: action.operator,
          value: undefined,
          status: "ready",
          query: "",
        }
      }
      return {
        ...state,
        operator: action.operator,
        value: action.value,
        step: "value",
        status: "editing",
        query: "",
      }
    }

    case "setValue":
      if (!state) return state
      return { ...state, value: action.value }

    case "commit":
      if (!state) return state
      return {
        ...state,
        value: action.value === undefined ? state.value : action.value,
        status: "ready",
      }

    case "back": {
      if (!state) return state
      const step = previousStep(state.step)
      if (!step) return null
      return { ...state, step, status: "editing", query: "" }
    }

    case "goto":
      if (!state) return state
      if (state.step === action.step) return state
      return { ...state, step: action.step, status: "editing", query: "" }

    default:
      return state
  }
}

/**
 * A path is enough. Not an operator: the flow commits when the field is picked,
 * so `operator: ""` is a legitimate committed state. Not a value either, since
 * `arity: "none"` has none and an editor may commit `undefined` to clear.
 */
export function isFilterDraftCommittable(draft) {
  return Boolean(draft && draft.path.length > 0)
}