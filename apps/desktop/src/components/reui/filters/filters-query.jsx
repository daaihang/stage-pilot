export function isFilterRule(node) {
  return node.type === "rule"
}

export function isFilterGroup(node) {
  return node.type === "group"
}

/**
 * A rule. `id` is passed in, never generated here: a non-deterministic value in
 * a pure function broke hydration. Callers use `createFilterIdFactory`.
 */
export function createFilterRule(input) {
  const rule = {
    id: input.id,
    type: "rule",
    path: input.path,
    operator: input.operator,
    value: input.value,
  }
  if (input.negated) rule.negated = true
  return rule
}

export function createFilterGroup(input) {
  return {
    id: input.id,
    type: "group",
    combinator: input.combinator ?? "and",
    rules: input.rules ?? [],
  }
}

/** An empty query. The root is always a group, never a bare array. */
export function createFilterQuery(rules = [], combinator = "and", id = "root") {
  return { id, type: "group", combinator, rules }
}

/** Every rule in the tree, depth first. Groups are flattened away. */
export function flattenFilterRules(query) {
  const out = []
  const walk = (node) => {
    if (isFilterRule(node)) {
      out.push(node)
      return
    }
    for (const child of node.rules) walk(child)
  }
  walk(query)
  return out
}

/**
 * Whether a rule says anything yet. A rule exists as soon as an attribute is
 * picked, so `operator: ""` is a real state: `flattenFilterConditions` leaves
 * it out, `countFilterRules` still counts it, and `collectFilterIssues` reports
 * it as `missing-operator`.
 */
export function isFilterRuleComplete(rule) {
  return rule.operator !== ""
}

/**
 * Flattens a query to conditions. Lossy: safe only when the query is flat or
 * every group shares the root's combinator. Read `query.combinator` and walk
 * the tree yourself for anything else. Incomplete rules are left out.
 */
export function flattenFilterConditions(query) {
  return flattenFilterRules(query)
    .filter(isFilterRuleComplete)
    .map((rule) => ({
      path: rule.path,
      field: rule.path[0],
      operator: rule.operator,
      values:
        rule.value === undefined || rule.value === null
          ? []
          : Array.isArray(rule.value)
            ? (rule.value)
            : [rule.value],
      negated: Boolean(rule.negated),
    }));
}

/** How many rules the query holds, at any depth. */
export function countFilterRules(query) {
  let count = 0
  const walk = (node) => {
    if (isFilterRule(node)) {
      count += 1
      return
    }
    for (const child of node.rules) walk(child)
  }
  walk(query)
  return count
}

/** Whether the query would match everything. */
export function isFilterQueryEmpty(query) {
  return countFilterRules(query) === 0
}

/** A value slot the user has not filled in. `false` and `0` are values. */
function isBlankFilterValue(value) {
  return value === undefined || value === null || value === ""
}

/**
 * Compares two range bounds, or gives up. Numbers, dates and ISO strings only:
 * inventing an order for a range of colour names would flag a correct filter as
 * reversed. `Date.parse` must parse BOTH strings before they are compared.
 */
function compareFilterBounds(from, to) {
  if (typeof from === "number" && typeof to === "number") {
    return Number.isNaN(from) || Number.isNaN(to) ? null : from - to
  }
  if (from instanceof Date && to instanceof Date) {
    const a = from.getTime()
    const b = to.getTime()
    return Number.isNaN(a) || Number.isNaN(b) ? null : a - b
  }
  if (typeof from === "string" && typeof to === "string") {
    const a = Date.parse(from)
    const b = Date.parse(to)
    return Number.isNaN(a) || Number.isNaN(b) ? null : a - b
  }
  return null
}

/**
 * Every reason a query cannot be run as written, in document order: the five
 * ways this builder can hold a condition that SILENTLY does the wrong thing.
 * `missing-operator` and `empty-group` carry no predicate and are dropped by
 * `flattenFilterConditions`; `missing-value` reaches the consumer with a
 * `values` array that is empty or all blank, which most backends read as
 * "match nothing"; `incomplete-range` is the same for a range and often
 * arrives with one bound FILLED, so an emptiness check will not catch it;
 * `reversed-range` is legal and matches nothing anywhere. A group of exactly
 * ONE node is NOT an issue (it is what "Convert to group" produces), and the
 * root is exempt from `empty-group`.
 */
export function collectFilterIssues(query, arityOf, validateOf) {
  const issues = []

  const visit = (group, isRoot) => {
    if (!isRoot && group.rules.length === 0) {
      issues.push({
        nodeId: group.id,
        column: "group",
        reason: "empty-group",
      })
    }

    for (const child of group.rules) {
      if (isFilterGroup(child)) {
        visit(child, false)
        continue
      }
      // Asked FIRST: `null` means the caller cannot judge this rule at all, so
      // even `missing-operator` would point at a control that is not on screen.
      const arity = arityOf(child)
      if (arity === null) continue

      if (!isFilterRuleComplete(child)) {
        issues.push({
          nodeId: child.id,
          column: "operator",
          reason: "missing-operator",
        })
        continue
      }

      if (arity === "none") continue

      const values =
        child.value === undefined || child.value === null
          ? []
          : Array.isArray(child.value)
            ? (child.value)
            : [child.value]

      if (arity === "range") {
        if (
          values.length < 2 ||
          isBlankFilterValue(values[0]) ||
          isBlankFilterValue(values[1])
        ) {
          issues.push({
            nodeId: child.id,
            column: "value",
            reason: "incomplete-range",
          })
          continue
        }
        const order = compareFilterBounds(values[0], values[1])
        if (order !== null && order > 0) {
          issues.push({
            nodeId: child.id,
            column: "value",
            reason: "reversed-range",
          })
        }
        continue
      }

      // `many` and `one` collapse here: both are unsatisfied by an empty list,
      // and `one` normalises to a single-element list above.
      if (values.length === 0 || values.every(isBlankFilterValue)) {
        issues.push({
          nodeId: child.id,
          column: "value",
          reason: "missing-value",
        })
        continue
      }

      // LAST, and only on a rule the primitive is already happy with: stacking
      // a second message on one cell breaks the one-issue-per-node shape.
      const message = validateOf?.(child)
      if (message) {
        issues.push({
          nodeId: child.id,
          column: "value",
          reason: "custom",
          message,
        })
      }
    }
  }

  visit(query, true)
  return issues
}

/** Locates a node and its parent. Returns null when the id is unknown. */
export function findFilterNode(query, id) {
  if (query.id === id) return { node: query, parent: null, index: -1 }

  const walk = group => {
    for (let i = 0; i < group.rules.length; i++) {
      const child = group.rules[i]
      if (child.id === id) return { node: child, parent: group, index: i }
      if (isFilterGroup(child)) {
        const found = walk(child)
        if (found) return found
      }
    }
    return null
  }

  return walk(query)
}

/** The rule with this id, or null when the id names a group or is unknown. */
export function findFilterRule(query, id) {
  const found = findFilterNode(query, id)
  if (!found || !isFilterRule(found.node)) return null
  return found.node
}

/**
 * Rebuilds the tree, applying `transform` to the group holding `id`. An
 * unchanged subtree comes back BY IDENTITY, so `React.memo` holds for all but
 * the moved chip. Tests assert it with `toBe`. `removeFilterNode` and
 * `detachFilterNode` drop children rather than replace a group, so they
 * hand-roll the same identity-preserving walk.
 */
function rewriteGroup(group, shouldRewrite, transform) {
  if (shouldRewrite(group)) return transform(group)

  let changed = false
  const rules = group.rules.map((child) => {
    if (!isFilterGroup(child)) return child
    const next = rewriteGroup(child, shouldRewrite, transform)
    if (next !== child) changed = true
    return next
  })

  return changed ? { ...group, rules } : group
}

/** Replaces a rule's fields. Unknown ids return the query unchanged. */
export function updateFilterRule(query, id, updates) {
  return rewriteGroup(query, (group) =>
    group.rules.some((child) => child.id === id && isFilterRule(child)), (group) => ({
    ...group,
    rules: group.rules.map((child) =>
      child.id === id && isFilterRule(child)
        ? { ...child, ...updates }
        : child
    ),
  }));
}

/**
 * Removes a node, plus any group it empties, all the way up (not the root): an
 * empty group is invisible in the flat UI yet still compiles to parentheses.
 */
export function removeFilterNode(query, id) {
  const prune = group => {
    let changed = false
    const rules = []

    for (const child of group.rules) {
      if (child.id === id) {
        changed = true
        continue
      }
      if (isFilterGroup(child)) {
        const next = prune(child)
        if (next !== child) changed = true
        if (next.rules.length === 0) continue
        rules.push(next)
        continue
      }
      rules.push(child)
    }

    return changed ? { ...group, rules } : group
  }

  return prune(query);
}

/** Appends a node to a group, defaulting to the root. */
export function insertFilterNode(query, node, parentId, index) {
  const targetId = parentId ?? query.id
  return rewriteGroup(query, (group) => group.id === targetId, (group) => {
    const rules = [...group.rules]
    const at =
      index === undefined
        ? rules.length
        : Math.max(0, Math.min(index, rules.length))
    rules.splice(at, 0, node)
    return { ...group, rules }
  });
}

/**
 * A deep copy under fresh ids, the whole way down: children keeping their old
 * ids would give two live nodes one id, and every lookup here is by id.
 */
function cloneFilterNode(node, nextId) {
  return isFilterRule(node)
    ? { ...node, id: nextId() }
    : {
        ...node,
        id: nextId(),
        rules: node.rules.map((child) => cloneFilterNode(child, nextId)),
      }
}

/** Copies a node in beside the original. */
export function duplicateFilterNode(query, id, nextId) {
  const found = findFilterNode(query, id)
  if (!found || !found.parent) return query

  return insertFilterNode(
    query,
    cloneFilterNode(found.node, nextId),
    found.parent.id,
    found.index + 1
  )
}

export function setFilterCombinator(query, groupId, combinator) {
  return rewriteGroup(query, (group) => group.id === groupId, (group) =>
    group.combinator === combinator ? group : { ...group, combinator });
}

export function toggleFilterCombinator(query, groupId) {
  const found = findFilterNode(query, groupId)
  if (!found || !isFilterGroup(found.node)) return query
  return setFilterCombinator(
    query,
    groupId,
    found.node.combinator === "and" ? "or" : "and"
  )
}

/** Moves a node within its own group. Out of range moves are no-ops. */
export function moveFilterNode(query, id, delta) {
  const found = findFilterNode(query, id)
  if (!found || !found.parent) return query

  const from = found.index
  const to = from + delta
  if (to < 0 || to >= found.parent.rules.length || delta === 0) return query

  return rewriteGroup(query, (group) => group.id === found.parent.id, (group) => {
    const rules = [...group.rules]
    const [moved] = rules.splice(from, 1)
    rules.splice(to, 0, moved)
    return { ...group, rules }
  });
}

/** Whether `id` names `node` itself or anything beneath it. */
function containsFilterNode(node, id) {
  if (node.id === id) return true
  if (isFilterRule(node)) return false
  return node.rules.some((child) => containsFilterNode(child, id))
}

/**
 * Removes a node WITHOUT pruning what it empties. A move cannot reuse
 * `removeFilterNode`: it would delete the group the drop is aimed at.
 */
function detachFilterNode(group, id) {
  let changed = false
  const rules = []

  for (const child of group.rules) {
    if (child.id === id) {
      changed = true
      continue
    }
    if (isFilterGroup(child)) {
      const next = detachFilterNode(child, id)
      if (next !== child) changed = true
      rules.push(next)
      continue
    }
    rules.push(child)
  }

  return changed ? { ...group, rules } : group
}

/**
 * Moves a node into another group, at an index: the cross-parent form of
 * `moveFilterNode`, which only reorders within one parent. Refuses a group into
 * itself or a descendant, which would leave a cycle, and refuses the root.
 */
export function moveFilterNodeTo(query, id, parentId, index) {
  const found = findFilterNode(query, id)
  if (!found || !found.parent) return query
  if (containsFilterNode(found.node, parentId)) return query

  const destination = findFilterNode(query, parentId)
  if (!destination || !isFilterGroup(destination.node)) return query

  // Within one parent the node's own slot disappears when it detaches, so
  // indexes after it shift down by one: without this a drag down is a no-op.
  const sameParent = found.parent.id === parentId
  const target = sameParent && found.index < index ? index - 1 : index
  if (sameParent && target === found.index) return query

  return insertFilterNode(
    detachFilterNode(query, id),
    found.node,
    parentId,
    target
  )
}

/**
 * Copies a node into a group at a position: the Alt path of the drag layer. Not
 * `duplicateFilterNode` then `moveFilterNodeTo`, which emits two queries for one
 * gesture and needs the id the first step minted and never returned. The clone
 * is taken BEFORE the insert, so copying a group into itself stays finite.
 */
export function copyFilterNodeTo(query, id, parentId, index, nextId) {
  const found = findFilterNode(query, id)
  if (!found || !found.parent) return query

  const destination = findFilterNode(query, parentId)
  if (!destination || !isFilterGroup(destination.node)) return query

  return insertFilterNode(
    query,
    cloneFilterNode(found.node, nextId),
    parentId,
    index
  )
}

/**
 * Wraps a node in a new group: the "Wrap in condition group" action, and the
 * keyboard path to nesting for a user who cannot drag.
 */
export function wrapFilterNodeInGroup(query, id, groupId, combinator = "or") {
  const found = findFilterNode(query, id)
  if (!found || !found.parent) return query

  return rewriteGroup(query, (group) => group.id === found.parent.id, (group) => ({
    ...group,
    rules: group.rules.map((child) =>
      child.id === id
        ? createFilterGroup({ id: groupId, combinator, rules: [child] })
        : child
    ),
  }));
}

/**
 * Dissolves a group into its parent, splicing its rules in at the position the
 * group held so wrap and unwrap round-trip. The root, a rule id and an unknown
 * id each return the query unchanged.
 */
export function unwrapFilterGroup(query, groupId) {
  if (query.id === groupId) return query
  const found = findFilterNode(query, groupId)
  if (!found || !found.parent || !isFilterGroup(found.node)) return query

  const dissolved = found.node
  return rewriteGroup(query, (group) => group.id === found.parent.id, (group) => {
    const rules = [...group.rules]
    rules.splice(found.index, 1, ...dissolved.rules)
    return { ...group, rules }
  });
}

/** Empties the query, keeping the root's identity fields. */
export function clearFilterQuery(query) {
  return query.rules.length === 0 ? query : { ...query, rules: [] }
}

/**
 * Drops empty groups and collapses a group whose only child is a group. Not
 * automatic: a user mid-edit may hold an almost-empty group. Call on persist.
 */
export function pruneFilterQuery(query) {
  const prune = node => {
    if (isFilterRule(node)) return node

    const rules = []
    for (const child of node.rules) {
      const next = prune(child)
      if (next) rules.push(next)
    }

    if (rules.length === 0) return null
    if (rules.length === 1 && isFilterGroup(rules[0])) return rules[0]
    return { ...node, rules }
  }

  const rules = []
  for (const child of query.rules) {
    const next = prune(child)
    if (next) rules.push(next)
  }
  return { ...query, rules }
}