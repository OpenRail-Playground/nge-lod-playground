# Adrian Approach

This document describes the current implementation of `Adrian Approach` in the Network Graphic Viewer.

## Goal

The Adrian approach is a timetable-oriented level-of-detail mode. It tries to identify nodes that are relevant because of recurring timing patterns and transfer opportunities, not just because of graph topology.

The main question is:

```text
Which nodes matter because trains arrive, depart, or connect there in a systematic way?
```

## Input Data Used

The approach uses the active category-filtered graph and the timing information found on trainrun sections.

For each node, the topology analysis collects:

- arrivals from `sourceArrival` or `targetArrival`
- departures from `sourceDeparture` or `targetDeparture`
- explicit node connections from `node.connections`
- graph topology such as branching nodes and endpoints

Times are normalized into a repeating 60-minute cycle.

## Configurable Parameters

Two UI parameters influence the classification:

- `System window Delta`: default `5` minutes
- `Short transfer up to`: default `8` minutes

Changing either value recomputes the visible LOD view.

## Node Roles

Nodes are assigned one of four Adrian roles.

### System Node

A node is a system node when it satisfies the 00-symmetry rule:

```text
arrival in [60 - Delta, 00]
departure in [00, Delta]
```

With the default Delta of 5 minutes, this means:

- at least one arrival at `:55`, `:56`, `:57`, `:58`, `:59`, or `:00`
- at least one departure at `:00`, `:01`, `:02`, `:03`, `:04`, or `:05`

The arrival and departure do not need to belong to the same trainrun.

### Connection Node

A node is a connection node when it is not a system node, but offers a short transfer opportunity.

This can happen in two ways:

- the node has explicit connections in the source data
- the shortest implicit arrival-to-departure transfer is less than or equal to the configured transfer threshold

Implicit transfers are calculated cyclically within the hour:

```text
transfer = (departure minute - arrival minute + 60) mod 60
```

Only positive transfer times are considered.

### Corridor Node

A node is a corridor node when it is topologically important but not a system or connection node.

Current rule:

- branching node, or
- graph endpoint

Branching is based on the number of distinct neighboring nodes. A node is a branch when it has at least three distinct neighbors.

### Rest Node

All other active nodes are rest nodes. These are ordinary through points, stops, or operating points without a key timetable role in the current filtered graph.

## Available Levels

### Level 5

All active stations are shown as boxes.

### Level 4

All nodes remain visible, but rest nodes are reduced to points.

Rules:

- system nodes are boxes
- connection nodes are boxes
- corridor nodes are boxes
- rest nodes are points

### Level 3

Only system, connection, and corridor nodes remain visible.

Rules:

- system nodes are boxes
- connection nodes are boxes
- corridor nodes are boxes
- rest nodes are hidden

### Level 2

Only system and connection nodes remain visible.

Rules:

- system nodes are boxes
- connection nodes are boxes
- corridor nodes are hidden
- rest nodes are hidden

### Level 1

Only system nodes remain visible.

Rules:

- system nodes are boxes
- all other nodes are hidden

## Edge Rendering

The Adrian approach uses the shared non-Martin corridor rule.

Visible edges are selected from the active category-filtered graph. If hidden intermediate nodes exist, the viewer keeps edges that belong to shortest corridors between visible nodes. This preserves connections between visible nodes while trimming components, branches, and detours that do not connect at least two visible nodes.

The original edge geometry is drawn; edges are not merged into direct visual corridors in this mode.

## Category Filtering

Category filters are evaluated before the Adrian classification.

When a train category is disabled:

- its trainrun sections are removed from the active graph
- arrivals and departures are recomputed from the remaining sections
- explicit/implicit transfer classification is recomputed
- corridor roles are recomputed from the filtered topology
- the current LOD level is applied again

## Tooltip Support

Tooltips and the selection panel expose the Adrian role, average arrival/departure minute, shortest transfer, stop status, and topology information. This is intended to make the timetable classification auditable.

## Known Boundaries

The 00-symmetry rule only checks whether some arrival and some departure fall into the configured windows. It does not currently validate pairings by trainrun direction, line, or explicit platform-side transfer.

The implicit transfer logic uses the shortest cyclic minute difference. It does not consider walking time, platform constraints, or capacity.
