# Stop Weights Approach

This document describes the current implementation of `Stop Weights Approach` in the Network Graphic Viewer.

## Goal

The Stop Weights approach extends the Jan approach by weighting trainruns according to how selectively they stop.

The main idea is:

```text
A trainrun that passes through many nodes but stops at only a few should contribute more weight at the nodes where it actually stops.
```

This helps distinguish nodes where important or fast trainruns stop from nodes that those trains merely pass through.

## Trainrun Weight

Each trainrun receives a stop weight:

```text
trainrun weight = traversed node count / stop count
```

Where:

- `traversed node count`: number of distinct nodes touched by the trainrun's sections
- `stop count`: number of those nodes where the trainrun is classified as stopping

If a trainrun has zero detected stops, the implementation falls back to:

```text
trainrun weight = traversed node count
```

The tooltip shows this value as:

```text
weight (stops/traversed stops/nodes)
```

## Stop Detection

A trainrun is classified as stopping at a node using the active source data.

The current logic is:

1. If the node's `trainrunCategoryHaltezeiten` entry for the trainrun category has `no_halt === true`, the trainrun does not stop there.
2. The implementation collects all ports at the node that belong to sections of the trainrun.
3. If the trainrun has zero or one matching port at the node, it is treated as stopping there. This covers starts, ends, and simple appearances.
4. If the trainrun has multiple matching ports and a transition between them is marked as `isNonStopTransit`, it is treated as passing through.
5. Otherwise, it is treated as stopping.

## Node Score Formula

The node score follows the Jan approach, but replaces the raw incident section count with weighted stop contributions.

```text
score = weighted stop contribution
      + branch score
      + endpoint score
```

Where:

```text
weighted stop contribution = sum of trainrun weights for incident sections where the trainrun stops at the node
branch score = max(0, distinct neighbor count - 2) * 8
endpoint score = 5 if the node is a graph endpoint, otherwise 0
```

Important detail:

```text
Passing trainruns do not add weighted score to the node.
```

This means a node where important trainruns only pass through receives less weight than a node where those trainruns actually stop.

## Thresholds

Thresholds are computed from score quantiles of the active graph.

Only nodes with at least one active section are included in the threshold population.

Current thresholds:

```text
Level 1: 90th percentile
Level 2: 75th percentile
Level 3: 50th percentile
Level 4: 25th percentile
Level 5: 0
```

The threshold is recomputed whenever category filters change.

## Available Levels

### Level 5

All active stations are shown as boxes.

### Level 4

All active nodes remain visible, but low-score nodes are reduced to points.

Rules:

- nodes with score >= Level 4 threshold are boxes
- nodes below the threshold are points

### Level 3

Nodes with at least a medium weighted score remain visible.

Rules:

- nodes with score >= Level 3 threshold are boxes
- nodes below the threshold are hidden

### Level 2

Nodes with a high weighted score remain visible.

Rules:

- nodes with score >= Level 2 threshold are boxes
- nodes below the threshold are hidden

### Level 1

Only nodes with the highest weighted stop scores remain visible.

Rules:

- nodes with score >= Level 1 threshold are boxes
- nodes below the threshold are hidden

## Edge Rendering

The Stop Weights approach uses the shared non-Martin corridor rule.

Visible edges are selected from the active category-filtered graph. If hidden intermediate nodes exist, the viewer keeps edges that belong to shortest corridors between visible nodes. This preserves connections between visible nodes while trimming components, branches, and detours that do not connect at least two visible nodes.

The original edge geometry is drawn; edges are not merged into direct visual corridors in this mode.

## Category Filtering

Category filters are evaluated before trainrun weights, topology, scores, and thresholds are used for LOD display.

When a train category is disabled:

- sections of that category are removed from the active graph
- topology roles are recalculated
- weighted stop contributions are evaluated on the remaining active edges
- score thresholds are recomputed from the filtered graph
- the selected LOD level is applied again

## Tooltip Support

Tooltips and the selection panel expose:

- the total stop-weight score
- the weighted stop contribution
- branch contribution
- endpoint contribution
- per-trainrun weight on hovered edges

## Known Boundaries

The stop detection depends on the source graph's port, transition, and `trainrunCategoryHaltezeiten` data. If those fields are incomplete or inconsistent, the weighted score can misclassify stops or pass-through movements.

The approach still uses the same local branch and endpoint bonuses as Jan. It does not include global centrality or explicit timetable connection quality.
