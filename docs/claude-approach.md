# Claude Approach

This document describes the current implementation of `Claude Approach` in the Network Graphic Viewer.

## Goal

The Claude approach is a hybrid level-of-detail mode. It combines hard invariants for main-network nodes with a continuous importance score for the remaining nodes.

The main question is:

```text
Which nodes are globally important enough to preserve as part of the main network?
```

Compared with Jan, Claude uses more global information. Compared with Adrian, it does not primarily optimize for timetable symmetry or transfer windows.

## Metrics Used

For each node, the implementation computes or collects:

- weighted betweenness centrality
- distinct neighbor count
- incident trainrun section frequency
- number of trainruns serving the node
- number of train categories serving the node
- explicit node connections
- endpoint and branching status

All scoring is based on the active category-filtered graph.

## Weighted Betweenness

Weighted betweenness centrality is calculated from shortest paths in the active graph.

Edge weights use travel time when available:

```text
edge weight = travelTime.time or backwardTravelTime.time
```

If no positive travel time is available, the implementation falls back to `1`.

The centrality algorithm counts how often a node lies on shortest paths between other nodes. Values are normalized later against the maximum value in the active graph.

## Mainline Score

Claude computes a separate mainline score:

```text
mainline score =
    normalized betweenness * 0.45
  + normalized frequency   * 0.35
  + normalized categories  * 0.20
```

The result is multiplied by 100 and rounded.

A mainline threshold is calculated as the 75th percentile of active nodes' mainline scores.

## General Score

For non-hard-invariant nodes, Claude also computes a general score:

```text
score =
    normalized betweenness * 0.35
  + normalized degree      * 0.20
  + normalized frequency   * 0.20
  + normalized trainruns   * 0.15
  + normalized categories  * 0.10
```

The result is multiplied by 100 and rounded.

Where:

- `degree`: distinct neighbor count
- `frequency`: incident trainrun section count
- `trainruns`: number of trainruns touching the node
- `categories`: number of train categories touching the node

## Hard Invariants

Hard invariant nodes are always assigned to LOD 1.

A node is a hard invariant when one of the following is true:

- it is a major junction
- it is an important connection node
- it is a major endpoint

### Major Junction

```text
is branching node
and incident section count >= 4
and mainline score >= mainline threshold
```

### Important Connection Node

```text
has explicit connections
and (incident section count >= 4 or mainline score >= mainline threshold)
```

### Major Endpoint

```text
is graph endpoint
and mainline score >= mainline threshold
and incident section count >= 4
```

## Soft Invariants

The implementation also marks some nodes as soft invariants:

- branching nodes
- graph endpoints
- nodes with explicit connections

Soft invariants are not automatically kept at all lower levels. They still need to pass the score thresholds unless they also qualify as hard invariants.

This tweak prevents small regional endpoints or small branch nodes from surviving too aggressively in low-detail views.

## Thresholds

General score thresholds are computed only from non-hard-invariant active nodes.

Current thresholds:

```text
Level 1: Infinity
Level 2: 75th percentile
Level 3: 50th percentile
Level 4: 25th percentile
Level 5: 0
```

Because Level 1 has an infinite score threshold, only hard invariants appear at Level 1.

## LOD Assignment

Each node receives a Claude LOD value:

```text
if hard invariant: LOD 1
else if score >= Level 2 threshold: LOD 2
else if score >= Level 3 threshold: LOD 3
else if score >= Level 4 threshold: LOD 4
else: LOD 5
```

The displayed level then keeps nodes whose assigned Claude LOD is less than or equal to the selected UI level.

## Available Levels

### Level 5

All active stations are shown as boxes.

### Level 4

Most nodes remain visible.

Rules:

- nodes with Claude LOD <= 4 are boxes
- remaining active nodes are points

### Level 3

Invariant nodes plus medium- and high-score nodes remain visible.

Rules:

- nodes with Claude LOD <= 3 are boxes
- nodes with Claude LOD 4 or 5 are hidden

### Level 2

Hard main-network nodes plus high-score nodes remain visible.

Rules:

- nodes with Claude LOD <= 2 are boxes
- nodes with Claude LOD 3, 4, or 5 are hidden

### Level 1

Only hard main-network nodes remain visible.

Rules:

- hard invariant nodes are boxes
- all other nodes are hidden

## Edge Rendering

The Claude approach uses the shared non-Martin corridor rule.

Visible edges are selected from the active category-filtered graph. If hidden intermediate nodes exist, the viewer keeps edges that belong to shortest corridors between visible nodes. This preserves connections between visible nodes while trimming components, branches, and detours that do not connect at least two visible nodes.

The original edge geometry is drawn; edges are not merged into direct visual corridors in this mode.

## Category Filtering

Category filters are evaluated before all Claude metrics.

When a train category is disabled:

- the active graph changes
- betweenness centrality is recomputed
- frequency, trainrun count, and category count are recomputed
- mainline threshold and score thresholds are recomputed
- hard and soft invariants are recalculated
- the selected LOD level is applied again

## Tooltip Support

Tooltips and the selection panel expose the Claude classification:

```text
LOD, score, mainline score, hard/soft invariant status
```

This helps audit why a node remains visible in lower-detail levels.

## Known Boundaries

The current implementation is computationally heavier than the other approaches because it recomputes weighted betweenness centrality on the active graph.

The score weights are heuristic. They were tuned to reduce small regional branches in low-detail views while preserving the main network, but they are not derived from an external optimization model.
