# Network Graphic Viewer

Small browser-based tool for plotting Netzgrafik-style graph JSON files.

## Run

```sh
python3 -m http.server 5173
```

Then open `http://127.0.0.1:5173/`.

The viewer loads `data/networkGraphic-2.json` by default. Use the file input to load another graph.

## Future Views

Node hiding rules are collected in `viewRules` near the top of `app.js`.

Each rule can expose a `hideNode(node, context)` function. The context currently includes:

- `data`: the complete source JSON
- `degree`: a `Map` of node id to visible section count before filtering

Example:

```js
const viewRules = [
  { name: "Hide Ausland", hideNode: (node) => node.labelIds?.includes(2) },
];
```

## Level of Detail Modes

Category filters are applied before level-of-detail analysis. Changing a trainrun category recomputes topology, scores, thresholds, timing roles, and visible corridors from the filtered graph.

## Morphology Model

The viewer derives a current morphology model for the active LOD. Hidden intermediate nodes are contracted into visible corridors, and each visible node receives a role based on the current reduced graph:

- `aktuelle Abzweigung`: connects at least three visible corridors in the current LOD
- `echtes Netzende`: terminal in the filtered source graph
- `Linienbeginn/-ende auf Kante`: a trainrun starts or ends at an inline node
- `temporäres LOD-Ende`: terminal created by the current reduction
- `Durchgangshalt`: through node where at least one active trainrun stops
- `reine Durchfahrt`: through node where no active trainrun stops

These roles are shown in node tooltips and the selection panel. Martin Level 1 uses this current reduced morphology for its junction decision.

The first implemented mode is `Ansatz Martin`.

- Level 5: all stations are shown as named boxes.
- Level 4: stations that only lie on one line are reduced to points, while inline stations where a trainrun starts or ends remain boxes.
- Level 3: like Level 4, but inline stations where a trainrun starts or ends are reduced to points.
- Level 2: only graph endpoints and branching stations remain visible.
- Level 1: only branching stations remain visible.

The current branching heuristic counts distinct neighboring stations, not geometric angles. A station with exactly two neighbors is treated as a through node even if the line bends by 90 degrees. For Martin Level 1, branching is recalculated on the reduced current-level corridor graph, so a station that only looked like a branch before lower-detail pruning is removed if it no longer connects at least three visible corridors.

In Martin mode, hidden nodes do not remove their trainrun sections. Levels 2-5 keep all sections from the category-filtered graph. Level 1 keeps sections as well, but trims hidden leaf branches whose graph-end station is no longer visible.

Other LOD modes keep edges when they belong to a shortest corridor between visible stations. Hidden intermediate stations can be crossed, but hidden-only detours, leaf branches, and components with fewer than two visible stations are trimmed away.

Stations rendered as boxes use a generated short name. Full station names remain available through hover tooltips and the selection panel.

Point nodes where no active trainrun stops are rendered as hollow circles; point nodes with stops are filled. Box nodes without stops keep a muted dashed outline. Pure pass-through nodes remain available for topology, but are visually distinguished from stations with stops.

The second implemented mode is `Ansatz Adrian`.

- Level 5: all stations are shown as boxes.
- Level 4: system, connection, and corridor nodes are shown as boxes; rest nodes are shown as points.
- Level 3: system, connection, and corridor nodes remain visible.
- Level 2: system and connection nodes remain visible.
- Level 1: only system nodes remain visible.

For Adrian mode, system nodes are detected from trainrun section timings: an arrival must fall into `[60 - Delta, 00]`, and a departure must fall into `[00, Delta]`. The default Delta is 5 minutes. Connection nodes are non-system nodes with explicit node connections or an implicit arrival-to-departure transfer at or below the configured short-transfer threshold, defaulting to 8 minutes. Corridor nodes reuse the topology role from Martin: branching stations or graph endpoints.

The third implemented mode is `Ansatz Jan`.

Each station gets a score:

```text
score = number of incident trainrun sections
      + max(0, distinct neighboring stations - 2) * 8
      + 5 if the station is a graph endpoint
```

Levels use score quantiles of the loaded graph. Level 1 keeps only the strongest stations, while Level 5 shows everything. Level 4 keeps all stations visible but reduces low-score stations to points.

In Jan mode, the same corridor rule applies: visible stations stay connected through hidden intermediate stations, while outside loops and dangling branches without two visible endpoints are removed.

The fourth implemented mode is `Ansatz Zughalte-Gewichte`.

This mode follows the Jan approach, but replaces the raw connection count with weighted trainrun stops. Each trainrun receives a stop weight:

```text
trainrun weight = traversed graph nodes / stops
```

A node counts as a stop when the train starts/ends there or has no `isNonStopTransit` transition through that node. Trainruns with fewer stops therefore contribute more weight, but only at nodes where they actually stop. Passing trains do not add weight to the node score.

```text
score = sum of weighted trainrun sections that stop at the node
      + max(0, distinct neighboring stations - 2) * 8
      + 5 if the station is a graph endpoint
```

Levels use score quantiles of the loaded graph, matching Jan mode. Level 1 keeps only the strongest weighted stations, while Level 5 shows everything. Level 4 keeps all stations visible but reduces low-score stations to points.

The fifth implemented mode is `Ansatz Claude`.

Claude mode follows a hard-mainline-first, score-second approach:

- Level 1: hard main-network nodes only.
- Level 2: hard main-network nodes plus high-score soft invariants and score nodes.
- Level 3: invariant nodes plus medium/high-score nodes.
- Level 4: invariant nodes plus most score nodes; remaining nodes are reduced to points.
- Level 5: all stations are shown as boxes.

Hard main-network nodes are major junctions, important connection nodes, or major endpoints that also pass a mainline score threshold. Ordinary graph endpoints and small branch junctions are treated as soft invariants and must pass the normal score thresholds to appear in lower levels. Non-hard nodes receive a normalized score from weighted betweenness centrality, degree, incident trainrun section frequency, number of serving trainruns, and number of line classes. Thresholds are quantile-based for the loaded graph.
