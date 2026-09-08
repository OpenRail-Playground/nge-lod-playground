# Martin Approach

This document describes the current implementation of `Martin Approach` in the Network Graphic Viewer.

## Goal

`Martin Approach` is a morphology-oriented level-of-detail approach. It aims to keep the geographic and topological shape of the graph stable while visually reducing or hiding less important nodes.

The approach deliberately does not optimize for timetable quality, traffic weight, or transfer importance. Its central question is:

```text
Which nodes are needed to understand the visible network structure?
```

## Available Levels

Martin uses levels 2 to 5 only. Level 1 was removed because the resulting view was too aggressively reduced and was not useful enough for the current graph.

### Level 5

All stations are shown as named boxes.

Rules:

- every node with at least one active edge is visible
- every visible node is rendered as a box
- all trainrun sections that remain after category filtering are drawn

### Level 4

Ordinary through nodes are reduced to points. Nodes where a trainrun starts or ends on an otherwise linear corridor remain visible as boxes.

Rules:

- true graph endpoints are visible as boxes
- branching nodes are visible as boxes
- inline trainrun termini are visible as boxes
- ordinary through stops are visible as points
- all trainrun sections that remain after category filtering are drawn

### Level 3

Level 3 is like Level 4, but inline trainrun termini are no longer emphasized as boxes.

Rules:

- true graph endpoints are visible as boxes
- branching nodes are visible as boxes
- inline trainrun termini are visible as points
- ordinary through stops are visible as points
- all trainrun sections that remain after category filtering are drawn

### Level 2

Only structural graph nodes remain visible.

Rules:

- true graph endpoints are visible as boxes
- branching nodes are visible as boxes
- inline trainrun termini are hidden
- ordinary through stops are hidden
- all trainrun sections that remain after category filtering remain part of the view
- edges are rendered as direct visual corridors between the remaining visible nodes

## Category Filtering

Train type/category filters are applied before the Martin LOD logic.

When a category is disabled:

- its trainrun sections are removed from the active graph
- topology is recalculated from the remaining sections
- roles such as endpoint, through node, and branching node are recalculated
- the visible LOD view is rebuilt from the filtered topology

This means a node can change role when categories are toggled. For example, a branching node can become an ordinary through node if the disabled category was the only reason it had a third neighbor.

## Topological Roles

The primary topology analysis is based on the filtered source graph.

### True Graph Endpoint

A node is a true graph endpoint when it has exactly one distinct neighboring node in the filtered graph.

```text
number of distinct neighbors = 1
```

### Branching Node

A node is a branching node when it has at least three distinct neighboring nodes in the filtered graph.

```text
number of distinct neighbors >= 3
```

Geometric angles do not define branches. A node with exactly two neighbors remains a through node even if the line bends by 90 degrees.

### Through Node

A node is a through node when it is neither a true graph endpoint nor a branching node.

```text
number of distinct neighbors = 2
```

### Inline Trainrun Terminus

A node is an inline trainrun terminus when at least one active trainrun starts or ends at this node, while the node itself is not a structural graph endpoint.

This role mainly matters in Level 4 and Level 3:

- in Level 4, these nodes remain visible as boxes
- in Level 3, they are reduced to points

## Stop vs. Pass-Through Rendering

In addition to the topological role, the viewer evaluates whether active trainruns stop at a node or only pass through it.

For point rendering:

- a filled point means that at least one active trainrun stops at this node
- a hollow point means that the node is a pure pass-through node

For box rendering:

- a normal box represents a node where at least one active trainrun stops
- a muted dashed box represents a pure pass-through node

Pure pass-through nodes can still be topologically important. They are therefore not removed automatically just because no train stops there.

## Current Morphology Model

The viewer also derives a current morphology model for the active LOD.

Hidden intermediate nodes are contracted into visible corridors. The visible nodes are then classified in the reduced graph:

- `current branch`: connects at least three visible corridors
- `true network endpoint`: is an endpoint in the filtered source graph
- `inline trainrun start/end`: a trainrun starts or ends at an inline node
- `temporary LOD endpoint`: appears as an endpoint only because of the current reduction
- `through stop`: through node where at least one active trainrun stops
- `pass-through only`: through node where no active trainrun stops

These roles appear in the tooltip and in the selection panel. They are also used visually:

- current branching nodes receive a subtle focus halo
- temporary LOD endpoints are muted and dashed
- pure pass-through nodes are hollow or dashed

## Edge Rendering

The data model and the rendering model are intentionally separate.

The data model keeps the original trainrun sections. This preserves correct filtering, scores, timing information, and tooltip behavior.

The rendering model decides how edges are drawn on the canvas.

### Levels 3 to 5

Levels 3, 4, and 5 draw the original trainrun sections.

In these levels, no nodes or only a small number of nodes are hidden, so the original section geometry remains readable.

### Level 2

Level 2 merges consecutive trainrun sections into visual corridors between the remaining visible nodes.

Node positions are not changed. Only the edge geometry is redrawn:

```text
visible node A -- hidden node -- hidden node -- visible node B
```

becomes:

```text
visible node A -------------------------------------------- visible node B
```

Multiple trainruns on the same corridor remain visible as parallel lines. The viewer offsets them slightly so that the line bundle remains legible.

If a merged corridor skips hidden intermediate nodes, the canvas draws a small badge on that corridor. The number in the badge is the number of hidden intermediate nodes skipped by this merged corridor.

## Connectivity Principle

Martin is designed to preserve visual connectedness in the network.

When nodes are hidden, the connecting trainrun sections are not simply removed. Visible nodes remain connected through the hidden intermediate path. In Level 2, that path is rendered as a direct corridor.

This avoids disconnected-looking graph fragments that would otherwise be caused only by LOD reduction.

## Implementation

The main implementation lives in `app.js`.

Important functions:

- `baseNodeDisplay(node)`: decides whether a Martin node is rendered as a box, point, or hidden
- `computeVisibleEdgeIdsForNodeIds(visibleNodeIds)`: keeps the active filtered trainrun sections visible for Martin mode
- `computeRenderEdges()`: creates merged render corridors for Martin Level 2
- `computeTrainrunRenderCorridors(...)`: follows a trainrun through hidden nodes until it reaches the next visible node
- `offsetRenderCorridors(corridors)`: offsets parallel corridor lines and decides where the hidden-node badge is drawn
- `currentMorphology()`: computes roles from the current reduced graph

## Known Boundaries

The current corridor merge follows each trainrun independently. This keeps multiple lines visible, but very dense corridors can still produce many parallel strokes.

The badge counts skipped nodes. It does not represent physical distance or the number of individual graphical gaps. It is a topological count.
