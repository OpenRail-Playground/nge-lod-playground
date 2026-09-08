# Jan Approach

This document describes the current implementation of `Jan Approach` in the Network Graphic Viewer.

## Goal

The Jan approach is a simple score-based level-of-detail mode. It ranks stations by local graph importance and keeps only nodes whose score is high enough for the selected level.

The main question is:

```text
Which nodes are important because many sections meet there, because the node branches, or because it terminates a route?
```

## Score Formula

Each active node receives a Jan score:

```text
score = incident section count
      + branch score
      + endpoint score
```

Where:

```text
branch score = max(0, distinct neighbor count - 2) * 8
endpoint score = 5 if the node is a graph endpoint, otherwise 0
```

Definitions:

- `incident section count`: number of active trainrun sections touching the node
- `distinct neighbor count`: number of distinct neighboring nodes in the category-filtered graph
- `graph endpoint`: a node with exactly one distinct neighbor
- `branching node`: a node with at least three distinct neighbors

Geometric angles do not create branches. A bend with exactly two neighbors is still a through node.

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

Nodes with at least a medium score remain visible.

Rules:

- nodes with score >= Level 3 threshold are boxes
- nodes below the threshold are hidden

### Level 2

Nodes with a high score remain visible.

Rules:

- nodes with score >= Level 2 threshold are boxes
- nodes below the threshold are hidden

### Level 1

Only the strongest local-score nodes remain visible.

Rules:

- nodes with score >= Level 1 threshold are boxes
- nodes below the threshold are hidden

## Edge Rendering

The Jan approach uses the shared non-Martin corridor rule.

Visible edges are selected from the active category-filtered graph. If hidden intermediate nodes exist, the viewer keeps edges that belong to shortest corridors between visible nodes. This preserves connections between visible nodes while trimming components, branches, and detours that do not connect at least two visible nodes.

The original edge geometry is drawn; edges are not merged into direct visual corridors in this mode.

## Category Filtering

Category filters are evaluated before scoring.

When a train category is disabled:

- its trainrun sections are removed from the active graph
- incident section counts change
- neighbor counts and endpoint/branch roles are recalculated
- score thresholds are recomputed from the filtered graph
- the selected LOD level is applied to the recomputed scores

## Tooltip Support

Tooltips and the selection panel expose the Jan score and its components:

```text
total score (sections + branch contribution + endpoint contribution)
```

## Known Boundaries

This approach is intentionally local. It does not know whether a corridor is part of a main line unless that importance is reflected in section count, branching, or endpoint status.

Because thresholds are quantile-based, the absolute meaning of a level depends on the currently loaded and category-filtered graph.
