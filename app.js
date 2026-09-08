const DATA_URL = "data/networkGraphic-2.json";

const state = {
  data: null,
  nodes: [],
  edges: [],
  trainruns: new Map(),
  categories: new Map(),
  topology: new Map(),
  janThresholds: new Map(),
  stopWeightThresholds: new Map(),
  claudeThresholds: new Map(),
  categoryVisibility: new Map(),
  hiddenNodeIds: new Set(),
  visibleNodeCache: null,
  visibleEdgeIdCache: null,
  visibleEdgeCache: null,
  lodMode: "martin",
  lodLevel: 5,
  adrianDelta: 5,
  adrianTransferThreshold: 8,
  selected: null,
  hovered: null,
  searchTerm: "",
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  dragging: false,
  dragStart: null,
  pixelRatio: window.devicePixelRatio || 1,
};

const viewRules = [
  // Future examples:
  // { name: "Hide Ausland", hideNode: (node) => node.labelIds?.includes(2) },
  // { name: "Hide leaf stations", hideNode: (node, ctx) => ctx.degree.get(node.id) <= 1 },
];

const canvas = document.getElementById("graph-canvas");
const ctx = canvas.getContext("2d");
const tooltip = document.getElementById("tooltip");
const fileInput = document.getElementById("file-input");
const searchInput = document.getElementById("search-input");
const lodMode = document.getElementById("lod-mode");
const lodLevel = document.getElementById("lod-level");
const lodLevelOutput = document.getElementById("lod-level-output");
const lodDescription = document.getElementById("lod-description");
const adrianSettings = document.getElementById("adrian-settings");
const adrianDelta = document.getElementById("adrian-delta");
const adrianTransfer = document.getElementById("adrian-transfer");
const fitButton = document.getElementById("fit-button");
const clearButton = document.getElementById("clear-button");
const categoryList = document.getElementById("category-list");
const selection = document.getElementById("selection");

const lodDescriptions = {
  martin: {
    5: "Alle Bahnhöfe werden als Boxen mit Namen dargestellt.",
    4: "Bahnhöfe, die nur auf einer Linie liegen, werden zu Punkten reduziert; Linien-Start/Ende bleiben Boxen.",
    3: "Wie Level 4; Linien-Start/Ende auf Kanten werden zu Punkten reduziert.",
    2: "Nur Abzweigungen und Endpunkte des Graphen bleiben sichtbar.",
    1: "Nur Abzweigungen, die im reduzierten Graphen noch mindestens drei sichtbare Korridore verbinden.",
  },
  adrian: {
    5: "Alle Bahnhöfe werden als Boxen dargestellt.",
    4: "System-, Anschluss- und Korridorknoten als Boxen; Restknoten als Punkte.",
    3: "System-, Anschluss- und Korridorknoten bleiben sichtbar.",
    2: "Systemknoten und Anschlussknoten bleiben sichtbar.",
    1: "Nur Systemknoten mit Ankunft vor 00 und Abfahrt nach 00 bleiben sichtbar.",
  },
  jan: {
    5: "Alle Bahnhöfe werden als Boxen dargestellt.",
    4: "Bahnhöfe mit niedrigem Score werden zu Punkten reduziert.",
    3: "Bahnhöfe ab mittlerem Score bleiben sichtbar.",
    2: "Bahnhöfe mit hohem Score bleiben sichtbar.",
    1: "Nur sehr stark frequentierte Knoten mit höchstem Score bleiben sichtbar.",
  },
  stopWeights: {
    5: "Alle Bahnhöfe werden als Boxen dargestellt.",
    4: "Bahnhöfe mit niedrigem Zughalte-Gewicht werden zu Punkten reduziert.",
    3: "Bahnhöfe ab mittlerem gewichteten Score bleiben sichtbar.",
    2: "Bahnhöfe mit hohem gewichteten Score bleiben sichtbar.",
    1: "Nur Knoten mit höchstem gewichteten Zughalte-Score bleiben sichtbar.",
  },
  claude: {
    5: "Vollnetz: alle Bahnhöfe werden als Boxen dargestellt.",
    4: "Hauptnetzknoten plus die meisten Score-Knoten bleiben sichtbar.",
    3: "Hauptnetzknoten plus mittlere und hohe Score-Knoten bleiben sichtbar.",
    2: "Hauptnetzknoten plus hohe Score-Knoten bleiben sichtbar.",
    1: "Nur harte Hauptnetzknoten bleiben sichtbar.",
  },
};

function getThemeColor(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function parseGraph(data) {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  const trainruns = new Map((data.trainruns || []).map((run) => [run.id, run]));
  const colors = new Map((data.metadata?.netzgrafikColors || []).map((entry) => [entry.colorRef, entry]));
  const categories = new Map();

  for (const category of data.metadata?.trainrunCategories || []) {
    const colorEntry = colors.get(category.colorRef);
    categories.set(category.id, {
      ...category,
      color: colorEntry?.color?.trim() || "#767676",
    });
  }
  const trainrunStopWeights = computeTrainrunStopWeights(data.nodes, data.trainrunSections || [], trainruns, categories);

  const degree = new Map(data.nodes.map((node) => [node.id, 0]));
  const edges = (data.trainrunSections || [])
    .filter((section) => nodeById.has(section.sourceNodeId) && nodeById.has(section.targetNodeId))
    .map((section) => {
      const trainrun = trainruns.get(section.trainrunId);
      const category = categories.get(trainrun?.categoryId);
      degree.set(section.sourceNodeId, (degree.get(section.sourceNodeId) || 0) + 1);
      degree.set(section.targetNodeId, (degree.get(section.targetNodeId) || 0) + 1);
      return {
        ...section,
        source: nodeById.get(section.sourceNodeId),
        target: nodeById.get(section.targetNodeId),
        trainrun,
        category,
        trainrunStopWeight: trainrunStopWeights.get(section.trainrunId)?.weight ?? 0,
        trainrunStopStats: trainrunStopWeights.get(section.trainrunId),
        points: normalizePath(section, nodeById),
      };
    });

  const topology = analyzeTopology(data.nodes, edges);
  const hiddenNodeIds = new Set();
  for (const node of data.nodes) {
    if (viewRules.some((rule) => rule.hideNode?.(node, { data, degree, topology }))) {
      hiddenNodeIds.add(node.id);
    }
  }

  return {
    nodes: data.nodes,
    edges,
    trainruns,
    categories,
    topology,
    janThresholds: new Map(),
    stopWeightThresholds: new Map(),
    claudeThresholds: new Map(),
    hiddenNodeIds,
  };
}

function computeTrainrunStopWeights(nodes, sections, trainruns, categories) {
  const sectionsById = new Map(sections.map((section) => [section.id, section]));
  const sectionsByTrainrunId = new Map();
  for (const section of sections) {
    if (!sectionsByTrainrunId.has(section.trainrunId)) sectionsByTrainrunId.set(section.trainrunId, []);
    sectionsByTrainrunId.get(section.trainrunId).push(section);
  }

  const weights = new Map();
  for (const [trainrunId, trainrunSections] of sectionsByTrainrunId) {
    const traversedNodeIds = new Set();
    const stopNodeIds = new Set();
    for (const section of trainrunSections) {
      traversedNodeIds.add(section.sourceNodeId);
      traversedNodeIds.add(section.targetNodeId);
    }

    let stops = 0;
    for (const node of nodes) {
      if (!traversedNodeIds.has(node.id)) continue;
      if (trainrunStopsAtNode(node, trainrunId, sectionsById, trainruns, categories)) {
        stops += 1;
        stopNodeIds.add(node.id);
      }
    }

    const traversed = traversedNodeIds.size;
    const stopRatio = traversed > 0 ? stops / traversed : 1;
    weights.set(trainrunId, {
      trainrunId,
      traversed,
      stops,
      stopNodeIds,
      stopRatio,
      weight: stops > 0 ? traversed / stops : traversed,
    });
  }

  return weights;
}

function trainrunStopsAtNode(node, trainrunId, sectionsById, trainruns, categories) {
  const category = categories.get(trainruns.get(trainrunId)?.categoryId);
  const haltInfo = node.trainrunCategoryHaltezeiten?.[category?.fachCategory];
  if (haltInfo?.no_halt === true) return false;

  const portIds = new Set();
  for (const port of node.ports || []) {
    const section = sectionsById.get(port.trainrunSectionId);
    if (section?.trainrunId === trainrunId) portIds.add(port.id);
  }

  if (portIds.size <= 1) return true;
  return !(node.transitions || []).some(
    (transition) => transition.isNonStopTransit && portIds.has(transition.port1Id) && portIds.has(transition.port2Id),
  );
}

function analyzeTopology(nodes, edges) {
  const topology = new Map(
    nodes.map((node) => [
      node.id,
      {
        degree: 0,
        neighbors: new Set(),
        trainrunCounts: new Map(),
        stoppingTrainrunIds: new Set(),
        categoryIds: new Set(),
        angles: [],
        arrivals: [],
        departures: [],
        explicitConnections: node.connections?.length || 0,
        weightedConnectionScore: 0,
        trainrunStopWeights: new Map(),
        directionGroups: [],
        isLineStop: false,
        isInlineTerminus: false,
        isGraphEnd: false,
        isJunction: false,
      },
    ]),
  );

  for (const edge of edges) {
    registerIncident(topology.get(edge.sourceNodeId), edge, edge.targetNodeId, directionAngle(edge, "source"), "source");
    registerIncident(topology.get(edge.targetNodeId), edge, edge.sourceNodeId, directionAngle(edge, "target"), "target");
  }

  for (const item of topology.values()) {
    item.directionGroups = groupParallelAngles(item.angles);
    const neighborCount = item.neighbors.size;
    const hasTerminatingTrainrun = [...item.trainrunCounts.values()].some((count) => count === 1);
    item.isGraphEnd = neighborCount === 1;
    item.nonParallelEdgeCount = neighborCount;
    item.isJunction = item.nonParallelEdgeCount >= 3;
    item.junctionCount = Math.max(0, item.nonParallelEdgeCount - 2);
    item.isLineStop = !item.isGraphEnd && !item.isJunction;
    item.isInlineTerminus = item.isLineStop && hasTerminatingTrainrun;
    item.janScore = janScore(item);
    item.stopWeightScore = stopWeightScore(item);
  }

  return topology;
}

function janScore(topology) {
  if (!topology) return 0;
  const connectionScore = topology.degree;
  const branchScore = topology.junctionCount * 8;
  const endpointScore = topology.isGraphEnd ? 5 : 0;
  return connectionScore + branchScore + endpointScore;
}

function computeJanThresholds(nodes, topology) {
  const scores = nodes
    .filter((node) => (topology.get(node.id)?.degree || 0) > 0)
    .map((node) => topology.get(node.id)?.janScore || 0)
    .sort((a, b) => a - b);
  return new Map([
    [1, quantile(scores, 0.9)],
    [2, quantile(scores, 0.75)],
    [3, quantile(scores, 0.5)],
    [4, quantile(scores, 0.25)],
    [5, 0],
  ]);
}

function stopWeightScore(topology) {
  if (!topology) return 0;
  const connectionScore = topology.weightedConnectionScore;
  const branchScore = topology.junctionCount * 8;
  const endpointScore = topology.isGraphEnd ? 5 : 0;
  return Math.round((connectionScore + branchScore + endpointScore) * 10) / 10;
}

function computeStopWeightThresholds(nodes, topology) {
  const scores = nodes
    .filter((node) => (topology.get(node.id)?.degree || 0) > 0)
    .map((node) => topology.get(node.id)?.stopWeightScore || 0)
    .sort((a, b) => a - b);
  return new Map([
    [1, quantile(scores, 0.9)],
    [2, quantile(scores, 0.75)],
    [3, quantile(scores, 0.5)],
    [4, quantile(scores, 0.25)],
    [5, 0],
  ]);
}

function quantile(sortedValues, q) {
  if (!sortedValues.length) return 0;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.ceil((sortedValues.length - 1) * q)));
  return sortedValues[index];
}

function computeClaudeScoresAndThresholds(nodes, edges, topology) {
  const betweenness = weightedBetweenness(nodes, edges);
  const rawValues = nodes.map((node) => {
    const item = topology.get(node.id);
    return {
      node,
      betweenness: betweenness.get(node.id) || 0,
      degree: item?.nonParallelEdgeCount || 0,
      frequency: item?.degree || 0,
      stops: item?.trainrunCounts.size || 0,
      classes: item?.categoryIds.size || 0,
    };
  });
  const activeRawValues = rawValues.filter((value) => value.frequency > 0);
  const mainlineValues = activeRawValues.map((value) => ({
    node: value.node,
    mainline:
      normalizeMetric(value.betweenness, maxOf(activeRawValues, "betweenness")) * 0.45 +
      normalizeMetric(value.frequency, maxOf(activeRawValues, "frequency")) * 0.35 +
      normalizeMetric(value.classes, maxOf(activeRawValues, "classes")) * 0.2,
  }));

  const scales = {
    betweenness: maxOf(activeRawValues, "betweenness"),
    degree: maxOf(activeRawValues, "degree"),
    frequency: maxOf(activeRawValues, "frequency"),
    stops: maxOf(activeRawValues, "stops"),
    classes: maxOf(activeRawValues, "classes"),
  };
  const mainlineThreshold = quantile(
    mainlineValues.map((value) => Math.round(value.mainline * 100)).sort((a, b) => a - b),
    0.75,
  );

  const scoredNodes = [];
  for (const values of rawValues) {
    const item = topology.get(values.node.id);
    const components = {
      betweenness: normalizeMetric(values.betweenness, scales.betweenness),
      degree: normalizeMetric(values.degree, scales.degree),
      frequency: normalizeMetric(values.frequency, scales.frequency),
      stops: normalizeMetric(values.stops, scales.stops),
      classes: normalizeMetric(values.classes, scales.classes),
    };
    const mainlineScore = Math.round(
      (components.betweenness * 0.45 + components.frequency * 0.35 + components.classes * 0.2) * 100,
    );
    const score =
      components.betweenness * 0.35 +
      components.degree * 0.2 +
      components.frequency * 0.2 +
      components.stops * 0.15 +
      components.classes * 0.1;
    const invariant = isClaudeInvariant(item, mainlineScore, mainlineThreshold);
    item.claude = {
      score: Math.round(score * 100),
      mainlineScore,
      lod: 5,
      invariant,
      softInvariant: isClaudeSoftInvariant(item),
      components,
      term: item ? [...item.trainrunCounts.values()].filter((count) => count === 1).length : 0,
    };
    if (values.frequency > 0 && !invariant) scoredNodes.push(item.claude.score);
  }

  scoredNodes.sort((a, b) => a - b);
  const thresholds = new Map([
    [1, Infinity],
    [2, quantile(scoredNodes, 0.75)],
    [3, quantile(scoredNodes, 0.5)],
    [4, quantile(scoredNodes, 0.25)],
    [5, 0],
  ]);

  for (const node of nodes) {
    const claude = topology.get(node.id)?.claude;
    if (!claude) continue;
    if (claude.invariant) {
      claude.lod = 1;
    } else if (claude.score >= thresholds.get(2)) {
      claude.lod = 2;
    } else if (claude.score >= thresholds.get(3)) {
      claude.lod = 3;
    } else if (claude.score >= thresholds.get(4)) {
      claude.lod = 4;
    } else {
      claude.lod = 5;
    }
  }

  return thresholds;
}

function maxOf(values, key) {
  return Math.max(0, ...values.map((value) => value[key] || 0));
}

function normalizeMetric(value, max) {
  return max > 0 ? value / max : 0;
}

function isClaudeInvariant(topology, mainlineScore, mainlineThreshold) {
  if (!topology) return false;
  const isMainline = mainlineScore >= mainlineThreshold;
  const isMajorJunction = topology.isJunction && topology.degree >= 4 && isMainline;
  const isImportantConnection = topology.explicitConnections > 0 && (topology.degree >= 4 || isMainline);
  const isMajorEndpoint = topology.isGraphEnd && isMainline && topology.degree >= 4;
  return isMajorJunction || isImportantConnection || isMajorEndpoint;
}

function isClaudeSoftInvariant(topology) {
  if (!topology) return false;
  return topology.isJunction || topology.isGraphEnd || topology.explicitConnections > 0;
}

function weightedBetweenness(nodes, edges) {
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) {
    const weight = Math.max(1, edge.travelTime?.time ?? edge.backwardTravelTime?.time ?? 1);
    adjacency.get(edge.sourceNodeId)?.push({ id: edge.targetNodeId, weight });
    adjacency.get(edge.targetNodeId)?.push({ id: edge.sourceNodeId, weight });
  }

  const centrality = new Map(nodes.map((node) => [node.id, 0]));
  for (const source of nodes) {
    const { stack, predecessors, sigma } = shortestPathDAG(source.id, adjacency);
    const delta = new Map(nodes.map((node) => [node.id, 0]));

    while (stack.length) {
      const w = stack.pop();
      for (const v of predecessors.get(w) || []) {
        const contribution = (sigma.get(v) / sigma.get(w)) * (1 + delta.get(w));
        delta.set(v, delta.get(v) + contribution);
      }
      if (w !== source.id) centrality.set(w, centrality.get(w) + delta.get(w));
    }
  }

  for (const [nodeId, value] of centrality) {
    centrality.set(nodeId, value / 2);
  }
  return centrality;
}

function shortestPathDAG(sourceId, adjacency) {
  const nodes = [...adjacency.keys()];
  const distances = new Map(nodes.map((nodeId) => [nodeId, Infinity]));
  const sigma = new Map(nodes.map((nodeId) => [nodeId, 0]));
  const predecessors = new Map(nodes.map((nodeId) => [nodeId, []]));
  const queue = new Set(nodes);
  const stack = [];
  distances.set(sourceId, 0);
  sigma.set(sourceId, 1);

  while (queue.size) {
    let v = null;
    let bestDistance = Infinity;
    for (const candidate of queue) {
      const distance = distances.get(candidate);
      if (distance < bestDistance) {
        bestDistance = distance;
        v = candidate;
      }
    }
    if (v == null || bestDistance === Infinity) break;
    queue.delete(v);
    stack.push(v);

    for (const neighbor of adjacency.get(v) || []) {
      if (!queue.has(neighbor.id)) continue;
      const candidateDistance = distances.get(v) + neighbor.weight;
      const oldDistance = distances.get(neighbor.id);
      if (candidateDistance < oldDistance - 1e-9) {
        distances.set(neighbor.id, candidateDistance);
        sigma.set(neighbor.id, sigma.get(v));
        predecessors.set(neighbor.id, [v]);
      } else if (Math.abs(candidateDistance - oldDistance) <= 1e-9) {
        sigma.set(neighbor.id, sigma.get(neighbor.id) + sigma.get(v));
        predecessors.get(neighbor.id).push(v);
      }
    }
  }

  return { stack, predecessors, sigma };
}

function registerIncident(item, edge, neighborId, angle, endpoint) {
  if (!item) return;
  item.degree += 1;
  const nodeId = endpoint === "source" ? edge.sourceNodeId : edge.targetNodeId;
  if (edge.trainrunStopStats?.stopNodeIds?.has(nodeId)) {
    item.weightedConnectionScore += edge.trainrunStopWeight || 0;
    if (edge.trainrunId != null) item.stoppingTrainrunIds.add(edge.trainrunId);
  }
  item.neighbors.add(neighborId);
  if (edge.trainrunId != null) {
    item.trainrunCounts.set(edge.trainrunId, (item.trainrunCounts.get(edge.trainrunId) || 0) + 1);
    if (edge.trainrunStopStats) item.trainrunStopWeights.set(edge.trainrunId, edge.trainrunStopStats);
  }
  if (edge.trainrun?.categoryId != null) {
    item.categoryIds.add(edge.trainrun.categoryId);
  }
  if (Number.isFinite(angle)) {
    item.angles.push(angle);
  }
  const arrival = endpoint === "source" ? edge.sourceArrival : edge.targetArrival;
  const departure = endpoint === "source" ? edge.sourceDeparture : edge.targetDeparture;
  addTiming(item.arrivals, arrival, edge);
  addTiming(item.departures, departure, edge);
}

function addTiming(target, timing, edge) {
  const raw = timing?.consecutiveTime ?? timing?.time;
  if (!Number.isFinite(raw)) return;
  target.push({
    minute: moduloMinute(raw),
    raw,
    trainrunId: edge.trainrunId,
    sectionId: edge.id,
  });
}

function moduloMinute(value) {
  return ((value % 60) + 60) % 60;
}

function directionAngle(edge, endpoint) {
  const points = endpoint === "source" ? edge.points : [...edge.points].reverse();
  for (let index = 1; index < points.length; index += 1) {
    const dx = points[index].x - points[0].x;
    const dy = points[index].y - points[0].y;
    if (Math.hypot(dx, dy) > 1) {
      return normalizeUndirectedAngle(Math.atan2(dy, dx));
    }
  }
  return NaN;
}

function normalizeUndirectedAngle(angle) {
  let normalized = angle % Math.PI;
  if (normalized < 0) normalized += Math.PI;
  return normalized;
}

function groupParallelAngles(angles) {
  const tolerance = (15 * Math.PI) / 180;
  const groups = [];
  for (const angle of angles) {
    const existing = groups.find((group) => angleDistance(group.angle, angle) <= tolerance);
    if (existing) {
      existing.count += 1;
      existing.angle = normalizeUndirectedAngle((existing.angle * (existing.count - 1) + angle) / existing.count);
    } else {
      groups.push({ angle, count: 1 });
    }
  }
  return groups;
}

function angleDistance(a, b) {
  const diff = Math.abs(a - b);
  return Math.min(diff, Math.PI - diff);
}

function normalizePath(section, nodeById) {
  const path = section.path?.path;
  if (Array.isArray(path) && path.length > 1) {
    return path.map((point) => ({ x: point.x, y: point.y }));
  }
  const source = nodeById.get(section.sourceNodeId);
  const target = nodeById.get(section.targetNodeId);
  return [
    { x: source.positionX, y: source.positionY },
    { x: target.positionX, y: target.positionY },
  ];
}

function setGraph(data) {
  const parsed = parseGraph(data);
  Object.assign(state, parsed, {
    data,
    selected: null,
    hovered: null,
    searchTerm: "",
    visibleNodeCache: null,
    visibleEdgeIdCache: null,
    visibleEdgeCache: null,
  });

  state.categoryVisibility = new Map();
  for (const categoryId of parsed.categories.keys()) {
    state.categoryVisibility.set(categoryId, true);
  }
  recomputeFilteredAnalysis();

  searchInput.value = "";
  renderCategoryControls();
  updateStats();
  updateSelection();
  fitGraph();
}

function visibleNodes() {
  if (!state.visibleNodeCache) {
    state.visibleNodeCache = computeVisibleNodes();
  }
  return state.visibleNodeCache;
}

function visibleEdges() {
  if (!state.visibleEdgeCache) {
    const edgeIds = visibleEdgeIds();
    state.visibleEdgeCache = state.edges.filter((edge) => edgeIds.has(edge.id));
  }
  return state.visibleEdgeCache;
}

function isEdgeVisible(edge) {
  return visibleEdgeIds().has(edge.id);
}

function visibleEdgeIds() {
  if (!state.visibleEdgeIdCache) {
    state.visibleEdgeIdCache = computeVisibleEdgeIds();
  }
  return state.visibleEdgeIdCache;
}

function invalidateVisibility() {
  state.visibleNodeCache = null;
  state.visibleEdgeIdCache = null;
  state.visibleEdgeCache = null;
}

function recomputeFilteredAnalysis() {
  const filteredEdges = state.edges.filter(isCategoryVisible);
  state.topology = analyzeTopology(state.nodes, filteredEdges);
  state.janThresholds = computeJanThresholds(state.nodes, state.topology);
  state.stopWeightThresholds = computeStopWeightThresholds(state.nodes, state.topology);
  state.claudeThresholds = computeClaudeScoresAndThresholds(state.nodes, filteredEdges, state.topology);
  invalidateVisibility();
}

function isCategoryVisible(edge) {
  const categoryId = edge.trainrun?.categoryId;
  return categoryId == null ? true : state.categoryVisibility.get(categoryId) !== false;
}

function computeVisibleNodes() {
  const baseNodes = state.nodes.filter((node) => baseNodeDisplay(node) !== "hidden");
  if (state.lodMode !== "martin" || state.lodLevel !== 1) return baseNodes;
  return refineMartinLevelOneNodes(baseNodes);
}

function refineMartinLevelOneNodes(baseNodes) {
  let visibleNodeIds = new Set(baseNodes.map((node) => node.id));

  while (true) {
    const edgeIds = computeVisibleEdgeIdsForNodeIds(visibleNodeIds);
    const contractedAdjacency = contractedVisibleAdjacency(edgeIds, visibleNodeIds);
    const nextVisibleNodeIds = new Set(
      baseNodes.filter((node) => (contractedAdjacency.get(node.id)?.size || 0) >= 3).map((node) => node.id),
    );

    if (sameSet(visibleNodeIds, nextVisibleNodeIds)) break;
    visibleNodeIds = nextVisibleNodeIds;
  }

  return baseNodes.filter((node) => visibleNodeIds.has(node.id));
}

function contractedVisibleAdjacency(edgeIds, visibleNodeIds) {
  const adjacency = new Map();
  for (const edge of state.edges) {
    if (!edgeIds.has(edge.id)) continue;
    addContractedNeighbor(adjacency, edge.sourceNodeId, edge.targetNodeId);
    addContractedNeighbor(adjacency, edge.targetNodeId, edge.sourceNodeId);
  }

  const result = new Map([...visibleNodeIds].map((nodeId) => [nodeId, new Set()]));
  for (const sourceNodeId of visibleNodeIds) {
    for (const neighborId of adjacency.get(sourceNodeId) || []) {
      findContractedVisibleNeighbors(sourceNodeId, neighborId, adjacency, visibleNodeIds, result.get(sourceNodeId));
    }
  }
  return result;
}

function addContractedNeighbor(adjacency, sourceNodeId, targetNodeId) {
  if (!adjacency.has(sourceNodeId)) adjacency.set(sourceNodeId, new Set());
  adjacency.get(sourceNodeId).add(targetNodeId);
}

function findContractedVisibleNeighbors(sourceNodeId, startNodeId, adjacency, visibleNodeIds, result) {
  const stack = [{ nodeId: startNodeId, previousNodeId: sourceNodeId }];
  const visitedHiddenNodeIds = new Set();

  while (stack.length) {
    const { nodeId, previousNodeId } = stack.pop();
    if (visibleNodeIds.has(nodeId)) {
      if (nodeId !== sourceNodeId) result.add(nodeId);
      continue;
    }
    if (visitedHiddenNodeIds.has(nodeId)) continue;
    visitedHiddenNodeIds.add(nodeId);

    for (const neighborId of adjacency.get(nodeId) || []) {
      if (neighborId !== previousNodeId) stack.push({ nodeId: neighborId, previousNodeId: nodeId });
    }
  }
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function computeVisibleEdgeIds() {
  const visibleNodeIds = new Set(visibleNodes().map((node) => node.id));
  return computeVisibleEdgeIdsForNodeIds(visibleNodeIds);
}

function computeVisibleEdgeIdsForNodeIds(visibleNodeIds) {
  const candidateEdges = state.edges.filter(
    (edge) => isCategoryVisible(edge) && !state.hiddenNodeIds.has(edge.sourceNodeId) && !state.hiddenNodeIds.has(edge.targetNodeId),
  );
  if (state.lodMode === "martin") {
    if (state.lodLevel === 1) return keepEdgesAfterHiddenLeafPruning(candidateEdges, visibleNodeIds);
    return new Set(candidateEdges.map((edge) => edge.id));
  }
  if (visibleNodeIds.size < 2) return new Set();
  if (candidateEdges.every((edge) => visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId))) {
    return new Set(candidateEdges.map((edge) => edge.id));
  }
  return keepShortestVisibleCorridorEdges(candidateEdges, visibleNodeIds);
}

function keepEdgesAfterHiddenLeafPruning(edges, visibleNodeIds) {
  const activeEdgeIds = new Set(edges.map((edge) => edge.id));
  const adjacency = new Map();

  for (const edge of edges) {
    addPruningAdjacency(adjacency, edge.sourceNodeId, edge.targetNodeId, edge.id);
    addPruningAdjacency(adjacency, edge.targetNodeId, edge.sourceNodeId, edge.id);
  }

  const queue = [...adjacency.keys()].filter((nodeId) => !visibleNodeIds.has(nodeId) && pruningNeighborCount(adjacency, activeEdgeIds, nodeId) <= 1);
  while (queue.length) {
    const nodeId = queue.pop();
    if (visibleNodeIds.has(nodeId) || pruningNeighborCount(adjacency, activeEdgeIds, nodeId) > 1) continue;

    for (const [neighborId, edgeIds] of adjacency.get(nodeId) || []) {
      let removedAny = false;
      for (const edgeId of edgeIds) {
        if (activeEdgeIds.delete(edgeId)) removedAny = true;
      }
      if (removedAny && !visibleNodeIds.has(neighborId) && pruningNeighborCount(adjacency, activeEdgeIds, neighborId) <= 1) {
        queue.push(neighborId);
      }
    }
  }

  return activeEdgeIds;
}

function addPruningAdjacency(adjacency, sourceNodeId, targetNodeId, edgeId) {
  if (!adjacency.has(sourceNodeId)) adjacency.set(sourceNodeId, new Map());
  if (!adjacency.get(sourceNodeId).has(targetNodeId)) adjacency.get(sourceNodeId).set(targetNodeId, new Set());
  adjacency.get(sourceNodeId).get(targetNodeId).add(edgeId);
}

function pruningNeighborCount(adjacency, activeEdgeIds, nodeId) {
  let count = 0;
  for (const edgeIds of adjacency.get(nodeId)?.values() || []) {
    if ([...edgeIds].some((edgeId) => activeEdgeIds.has(edgeId))) count += 1;
  }
  return count;
}

function keepShortestVisibleCorridorEdges(edges, visibleNodeIds) {
  const adjacency = weightedEdgeAdjacency(edges);
  const keptNodePairs = new Set();

  for (const sourceNodeId of visibleNodeIds) {
    const predecessors = shortestPathPredecessors(sourceNodeId, adjacency);
    for (const targetNodeId of visibleNodeIds) {
      if (targetNodeId !== sourceNodeId) collectPathPairs(sourceNodeId, targetNodeId, predecessors, keptNodePairs);
    }
  }

  for (const edge of edges) {
    if (visibleNodeIds.has(edge.sourceNodeId) && visibleNodeIds.has(edge.targetNodeId)) {
      keptNodePairs.add(nodePairKey(edge.sourceNodeId, edge.targetNodeId));
    }
  }

  return new Set(edges.filter((edge) => keptNodePairs.has(nodePairKey(edge.sourceNodeId, edge.targetNodeId))).map((edge) => edge.id));
}

function weightedEdgeAdjacency(edges) {
  const adjacency = new Map();
  for (const edge of edges) {
    const weight = edgeWeight(edge);
    addWeightedNeighbor(adjacency, edge.sourceNodeId, edge.targetNodeId, weight);
    addWeightedNeighbor(adjacency, edge.targetNodeId, edge.sourceNodeId, weight);
  }
  return adjacency;
}

function addWeightedNeighbor(adjacency, sourceNodeId, targetNodeId, weight) {
  if (!adjacency.has(sourceNodeId)) adjacency.set(sourceNodeId, new Map());
  const existing = adjacency.get(sourceNodeId).get(targetNodeId);
  adjacency.get(sourceNodeId).set(targetNodeId, Math.min(existing ?? Infinity, weight));
}

function edgeWeight(edge) {
  const travelTime = edge.travelTime?.time ?? edge.backwardTravelTime?.time;
  if (Number.isFinite(travelTime) && travelTime > 0) return travelTime;
  let length = 0;
  for (let index = 1; index < edge.points.length; index += 1) {
    length += Math.hypot(edge.points[index].x - edge.points[index - 1].x, edge.points[index].y - edge.points[index - 1].y);
  }
  return Math.max(1, length);
}

function shortestPathPredecessors(sourceNodeId, adjacency) {
  const nodes = [...adjacency.keys()];
  const distances = new Map(nodes.map((nodeId) => [nodeId, Infinity]));
  const predecessors = new Map();
  const queue = new Set(nodes);
  distances.set(sourceNodeId, 0);

  while (queue.size) {
    let nodeId = null;
    let bestDistance = Infinity;
    for (const candidateId of queue) {
      const distance = distances.get(candidateId);
      if (distance < bestDistance) {
        bestDistance = distance;
        nodeId = candidateId;
      }
    }
    if (nodeId == null || bestDistance === Infinity) break;
    queue.delete(nodeId);

    for (const [neighborId, weight] of adjacency.get(nodeId) || []) {
      if (!queue.has(neighborId)) continue;
      const nextDistance = bestDistance + weight;
      if (nextDistance < distances.get(neighborId)) {
        distances.set(neighborId, nextDistance);
        predecessors.set(neighborId, nodeId);
      }
    }
  }

  return predecessors;
}

function collectPathPairs(sourceNodeId, targetNodeId, predecessors, keptNodePairs) {
  let currentNodeId = targetNodeId;
  const visited = new Set();
  while (currentNodeId !== sourceNodeId && predecessors.has(currentNodeId) && !visited.has(currentNodeId)) {
    visited.add(currentNodeId);
    const predecessorNodeId = predecessors.get(currentNodeId);
    keptNodePairs.add(nodePairKey(currentNodeId, predecessorNodeId));
    currentNodeId = predecessorNodeId;
  }
}

function nodePairKey(a, b) {
  return String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
}

function nodeDisplay(node) {
  if (!state.visibleNodeCache) return baseNodeDisplay(node);
  const visibleNodeIds = new Set(state.visibleNodeCache.map((visibleNode) => visibleNode.id));
  return visibleNodeIds.has(node.id) ? baseNodeDisplay(node) : "hidden";
}

function baseNodeDisplay(node) {
  if (state.hiddenNodeIds.has(node.id)) return "hidden";
  const topology = state.topology.get(node.id);
  if (!topology || topology.degree === 0) return "hidden";
  if (state.lodMode === "adrian") return adrianNodeDisplay(node);
  if (state.lodMode === "jan") return janNodeDisplay(node);
  if (state.lodMode === "stopWeights") return stopWeightNodeDisplay(node);
  if (state.lodMode === "claude") return claudeNodeDisplay(node);
  if (state.lodMode !== "martin") return "box";

  switch (state.lodLevel) {
    case 5:
      return "box";
    case 4:
      if (topology.isInlineTerminus) return "box";
      return topology.isLineStop ? "point" : "box";
    case 3:
      if (topology.isInlineTerminus) return "point";
      return topology.isLineStop ? "point" : "box";
    case 2:
      return topology.isJunction || topology.isGraphEnd ? "box" : "hidden";
    case 1:
      return topology.isJunction ? "box" : "hidden";
    default:
      return "box";
  }
}

function janNodeDisplay(node) {
  const topology = state.topology.get(node.id);
  const score = topology?.janScore || 0;
  const threshold = state.janThresholds.get(state.lodLevel) || 0;

  if (state.lodLevel === 5) return "box";
  if (state.lodLevel === 4) return score >= threshold ? "box" : "point";
  return score >= threshold ? "box" : "hidden";
}

function stopWeightNodeDisplay(node) {
  const topology = state.topology.get(node.id);
  const score = topology?.stopWeightScore || 0;
  const threshold = state.stopWeightThresholds.get(state.lodLevel) || 0;

  if (state.lodLevel === 5) return "box";
  if (state.lodLevel === 4) return score >= threshold ? "box" : "point";
  return score >= threshold ? "box" : "hidden";
}

function claudeNodeDisplay(node) {
  const claude = state.topology.get(node.id)?.claude;
  if (!claude) return state.lodLevel === 5 ? "box" : "hidden";
  if (state.lodLevel === 5) return "box";
  if (claude.lod <= state.lodLevel) return "box";
  if (state.lodLevel === 4) return "point";
  return "hidden";
}

function adrianNodeDisplay(node) {
  const role = adrianNodeRole(node);

  switch (state.lodLevel) {
    case 5:
      return "box";
    case 4:
      return role === "rest" ? "point" : "box";
    case 3:
      return role === "system" || role === "connection" || role === "corridor" ? "box" : "hidden";
    case 2:
      return role === "system" || role === "connection" ? "box" : "hidden";
    case 1:
      return role === "system" ? "box" : "hidden";
    default:
      return "box";
  }
}

function adrianNodeRole(node) {
  const topology = state.topology.get(node.id);
  if (!topology) return "rest";
  if (isSystemNode(topology)) return "system";
  if (isConnectionNode(topology)) return "connection";
  if (topology.isJunction || topology.isGraphEnd) return "corridor";
  return "rest";
}

function isSystemNode(topology) {
  if (!topology) return false;
  return topology.arrivals.some((arrival) => isArrivalBeforeZero(arrival.minute)) && topology.departures.some((departure) => isDepartureAfterZero(departure.minute));
}

function isArrivalBeforeZero(minute) {
  return minute === 0 || minute >= 60 - state.adrianDelta;
}

function isDepartureAfterZero(minute) {
  return minute <= state.adrianDelta;
}

function isConnectionNode(topology) {
  if (!topology) return false;
  if (isSystemNode(topology)) return false;
  if (topology.explicitConnections > 0) return true;
  return shortestTransfer(topology) <= state.adrianTransferThreshold;
}

function shortestTransfer(topology) {
  if (!topology) return Infinity;
  let best = Infinity;
  for (const arrival of topology.arrivals) {
    for (const departure of topology.departures) {
      const transfer = (departure.minute - arrival.minute + 60) % 60;
      if (transfer > 0) best = Math.min(best, transfer);
    }
  }
  return best;
}

function graphBounds() {
  const points = [];
  for (const node of visibleNodes()) {
    points.push({ x: node.positionX, y: node.positionY });
  }
  for (const edge of visibleEdges()) {
    points.push(...edge.points);
  }

  if (!points.length) return { minX: 0, maxX: 1, minY: 0, maxY: 1 };

  return points.reduce(
    (box, point) => ({
      minX: Math.min(box.minX, point.x),
      maxX: Math.max(box.maxX, point.x),
      minY: Math.min(box.minY, point.y),
      maxY: Math.max(box.maxY, point.y),
    }),
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
  );
}

function fitGraph() {
  const bounds = graphBounds();
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const margin = width < 700 ? 36 : 72;
  const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
  const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
  state.scale = Math.min((width - margin * 2) / graphWidth, (height - margin * 2) / graphHeight);
  state.offsetX = (width - graphWidth * state.scale) / 2 - bounds.minX * state.scale;
  state.offsetY = (height - graphHeight * state.scale) / 2 - bounds.minY * state.scale;
  draw();
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  state.pixelRatio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * state.pixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * state.pixelRatio));
  ctx.setTransform(state.pixelRatio, 0, 0, state.pixelRatio, 0, 0);
  draw();
}

function toScreen(point) {
  return {
    x: point.x * state.scale + state.offsetX,
    y: point.y * state.scale + state.offsetY,
  };
}

function toWorld(point) {
  return {
    x: (point.x - state.offsetX) / state.scale,
    y: (point.y - state.offsetY) / state.scale,
  };
}

function draw() {
  if (!state.data) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const edge of visibleEdges()) {
    drawEdge(edge);
  }

  for (const node of visibleNodes()) {
    drawNode(node, nodeDisplay(node));
  }

  ctx.restore();
}

function drawEdge(edge) {
  const color = edge.category?.color || getThemeColor("--muted");
  const isSelected = state.selected?.type === "edge" && state.selected.item.id === edge.id;
  const isHovered = state.hovered?.type === "edge" && state.hovered.item.id === edge.id;

  ctx.beginPath();
  edge.points.forEach((point, index) => {
    const screen = toScreen(point);
    if (index === 0) ctx.moveTo(screen.x, screen.y);
    else ctx.lineTo(screen.x, screen.y);
  });
  ctx.strokeStyle = color;
  ctx.globalAlpha = isSelected || isHovered ? 1 : 0.64;
  ctx.lineWidth = isSelected ? 5 : isHovered ? 4 : 2.2;
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawNode(node, display) {
  const screen = toScreen({ x: node.positionX, y: node.positionY });
  const isSelected = state.selected?.type === "node" && state.selected.item.id === node.id;
  const isHovered = state.hovered?.type === "node" && state.hovered.item.id === node.id;
  const matchesSearch = state.searchTerm && nodeMatches(node, state.searchTerm);
  const passThroughOnly = isPassThroughOnlyNode(node);

  if (display === "box") {
    drawNodeBox(node, screen, isSelected || matchesSearch, isHovered, passThroughOnly);
    return;
  }

  const radius = isSelected || matchesSearch ? 7 : isHovered ? 6 : 4.8;
  ctx.beginPath();
  ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = isSelected || matchesSearch ? getThemeColor("--focus") : passThroughOnly ? getThemeColor("--background") : getThemeColor("--text");
  ctx.strokeStyle = getThemeColor("--text");
  ctx.lineWidth = isSelected || matchesSearch ? 2.2 : 1.1;
  ctx.fill();
  ctx.stroke();
}

function drawNodeBox(node, screen, emphasized, hovered, passThroughOnly) {
  const label = shortStationName(node);
  ctx.font = `${emphasized ? 700 : 600} 11px system-ui, sans-serif`;
  const metrics = ctx.measureText(label);
  const width = Math.max(34, metrics.width + 13);
  const height = 24;
  const x = screen.x - width / 2;
  const y = screen.y - height / 2;
  const borderColor = emphasized || hovered ? getThemeColor("--focus") : passThroughOnly ? getThemeColor("--muted") : getThemeColor("--text");

  ctx.fillStyle = getThemeColor("--panel");
  ctx.strokeStyle = borderColor;
  ctx.lineWidth = emphasized ? 2 : 1.2;
  if (passThroughOnly && !emphasized && !hovered) ctx.setLineDash([5, 3]);
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 5);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = passThroughOnly && !emphasized && !hovered ? getThemeColor("--muted") : getThemeColor("--text");
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, screen.x, screen.y + 0.5);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";
}

function isPassThroughOnlyNode(node) {
  const topology = state.topology.get(node.id);
  return Boolean(topology && topology.degree > 0 && topology.stoppingTrainrunIds.size === 0);
}

function shortStationName(node) {
  const name = (node.betriebspunktName || node.fullName || String(node.id)).trim();
  const cleaned = name
    .replace(/\b(Bahnhof|Bf|Hbf|Hauptbahnhof|Station)\b/gi, "")
    .replace(/[()]/g, " ")
    .trim();
  const words = cleaned.split(/[\s-/]+/).filter(Boolean);
  if (!words.length) return String(node.id);

  const meaningful = words.filter((word) => !/^(am|an|bei|der|die|das|in|im|ob|und|zur|zum)$/i.test(word));
  const source = meaningful.length ? meaningful : words;
  if (source.length === 1) {
    return source[0].slice(0, 3).toUpperCase();
  }
  if (source.length === 2) {
    return `${source[0].slice(0, 2)}${source[1][0]}`.toUpperCase();
  }
  return source
    .map((word) => word[0])
    .join("")
    .slice(0, 5)
    .toUpperCase();
}

function nearestItem(screenPoint) {
  const world = toWorld(screenPoint);
  let bestNode = null;
  let bestNodeDistance = Infinity;
  for (const node of visibleNodes()) {
    const display = nodeDisplay(node);
    const distance = nodeHitDistance(node, display, screenPoint, world);
    if (distance < bestNodeDistance) {
      bestNodeDistance = distance;
      bestNode = node;
    }
  }
  if (bestNodeDistance <= 14) return { type: "node", item: bestNode, distance: bestNodeDistance };

  let bestEdge = null;
  let bestEdgeDistance = Infinity;
  for (const edge of state.edges) {
    if (!isEdgeVisible(edge)) continue;
    const distance = distanceToPolyline(world, edge.points) * state.scale;
    if (distance < bestEdgeDistance) {
      bestEdgeDistance = distance;
      bestEdge = edge;
    }
  }
  if (bestEdgeDistance <= 10) return { type: "edge", item: bestEdge, distance: bestEdgeDistance };
  return null;
}

function nodeHitDistance(node, display, screenPoint, worldPoint) {
  if (display === "box") {
    const screen = toScreen({ x: node.positionX, y: node.positionY });
    const label = shortStationName(node);
    ctx.save();
    ctx.font = "600 11px system-ui, sans-serif";
    const width = Math.max(34, ctx.measureText(label).width + 13);
    ctx.restore();
    const halfWidth = width / 2;
    const halfHeight = 12;
    const dx = Math.max(Math.abs(screenPoint.x - screen.x) - halfWidth, 0);
    const dy = Math.max(Math.abs(screenPoint.y - screen.y) - halfHeight, 0);
    return Math.hypot(dx, dy);
  }

  const dx = node.positionX - worldPoint.x;
  const dy = node.positionY - worldPoint.y;
  return Math.hypot(dx, dy) * state.scale;
}

function distanceToPolyline(point, points) {
  let best = Infinity;
  for (let index = 1; index < points.length; index += 1) {
    best = Math.min(best, distanceToSegment(point, points[index - 1], points[index]));
  }
  return best;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function nodeMatches(node, term) {
  const haystack = `${node.id} ${node.betriebspunktName || ""} ${node.fullName || ""}`.toLowerCase();
  return haystack.includes(term.toLowerCase());
}

function renderCategoryControls() {
  categoryList.replaceChildren();
  const categories = [...state.categories.values()].sort((a, b) => a.order - b.order);
  for (const category of categories) {
    const label = document.createElement("label");
    label.className = "category";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = state.categoryVisibility.get(category.id) !== false;
    checkbox.addEventListener("change", () => {
      state.categoryVisibility.set(category.id, checkbox.checked);
      recomputeFilteredAnalysis();
      if (state.selected?.type === "edge" && !isEdgeVisible(state.selected.item)) {
        state.selected = null;
      }
      if (state.selected?.type === "node" && nodeDisplay(state.selected.item) === "hidden") {
        state.selected = null;
      }
      updateSelection();
      updateStats();
      draw();
    });

    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = category.color;

    const name = document.createElement("span");
    name.className = "category-name";
    name.textContent = `${category.shortName || category.name} - ${category.name}`;

    label.append(checkbox, swatch, name);
    categoryList.append(label);
  }
}

function updateStats() {
  document.getElementById("node-count").textContent = state.nodes.length.toLocaleString();
  document.getElementById("edge-count").textContent = visibleEdges().length.toLocaleString();
  document.getElementById("visible-node-count").textContent = visibleNodes().length.toLocaleString();
  lodLevelOutput.textContent = String(state.lodLevel);
  const baseDescription = lodDescriptions[state.lodMode]?.[state.lodLevel] || "";
  const janThreshold = state.janThresholds.get(state.lodLevel);
  const stopWeightThreshold = state.stopWeightThresholds.get(state.lodLevel);
  const claudeThreshold = state.claudeThresholds.get(state.lodLevel);
  if (state.lodMode === "jan" && state.lodLevel < 5) {
    lodDescription.textContent = `${baseDescription} Grenzwert: Score >= ${janThreshold}.`;
  } else if (state.lodMode === "stopWeights" && state.lodLevel < 5) {
    lodDescription.textContent = `${baseDescription} Grenzwert: Score >= ${stopWeightThreshold}.`;
  } else if (state.lodMode === "claude" && state.lodLevel > 1 && state.lodLevel < 5) {
    lodDescription.textContent = `${baseDescription} Grenzwert: Score >= ${claudeThreshold}.`;
  } else {
    lodDescription.textContent = baseDescription;
  }
  adrianSettings.hidden = state.lodMode !== "adrian";
}

function updateSelection() {
  if (!state.selected) {
    selection.className = "selection muted";
    selection.textContent = "Select a node or section.";
    return;
  }

  selection.className = "selection";
  if (state.selected.type === "node") {
    const node = state.selected.item;
    const topology = state.topology.get(node.id);
    selection.innerHTML = `
      <strong>${escapeHtml(node.betriebspunktName || node.fullName || node.id)}</strong>
      <dl>
        <dt>ID</dt><dd>${node.id}</dd>
        <dt>Platforms</dt><dd>${node.perronkanten ?? "n/a"}</dd>
        <dt>Ports</dt><dd>${node.ports?.length ?? 0}</dd>
        <dt>Kanten</dt><dd>${topology?.degree ?? 0}</dd>
        <dt>Nachbarn</dt><dd>${topology?.nonParallelEdgeCount ?? 0}</dd>
        <dt>Halte</dt><dd>${formatStopStatus(topology)}</dd>
        <dt>Jan Score</dt><dd>${formatJanScore(topology)}</dd>
        <dt>Zughalte-Score</dt><dd>${formatStopWeightScore(topology)}</dd>
        <dt>Claude</dt><dd>${formatClaudeScore(topology)}</dd>
        <dt>Adrian</dt><dd>${escapeHtml(adrianRoleLabel(adrianNodeRole(node)))}</dd>
        <dt>Umstieg</dt><dd>${formatTransfer(shortestTransfer(topology))}</dd>
        <dt>Labels</dt><dd>${(node.labelIds || []).join(", ") || "none"}</dd>
      </dl>
    `;
  } else {
    const edge = state.selected.item;
    selection.innerHTML = `
      <strong>${escapeHtml(edge.trainrun?.name || `Section ${edge.id}`)}</strong>
      <dl>
        <dt>Section</dt><dd>${edge.id}</dd>
        <dt>From</dt><dd>${escapeHtml(edge.source.betriebspunktName || edge.sourceNodeId)}</dd>
        <dt>To</dt><dd>${escapeHtml(edge.target.betriebspunktName || edge.targetNodeId)}</dd>
        <dt>Category</dt><dd>${escapeHtml(edge.category?.shortName || "n/a")}</dd>
        <dt>Travel</dt><dd>${edge.travelTime?.time ?? "n/a"} min</dd>
        <dt>Zuggewicht</dt><dd>${formatTrainrunStopWeight(edge.trainrunStopStats)}</dd>
      </dl>
    `;
  }
}

function adrianRoleLabel(role) {
  return {
    system: "Systemknoten",
    connection: "Anschlussknoten",
    corridor: "Korridorknoten",
    rest: "Restknoten",
  }[role] || role;
}

function formatTransfer(value) {
  if (!Number.isFinite(value)) return "n/a";
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} min`;
}

function formatJanScore(topology) {
  if (!topology) return "0";
  const branchScore = topology.junctionCount * 8;
  const endpointScore = topology.isGraphEnd ? 5 : 0;
  return `${topology.janScore} (${topology.degree} Verbindungen + ${branchScore} Abzweigung + ${endpointScore} Ende)`;
}

function formatStopWeightScore(topology) {
  if (!topology) return "0";
  const branchScore = topology.junctionCount * 8;
  const endpointScore = topology.isGraphEnd ? 5 : 0;
  return `${topology.stopWeightScore} (${formatNumber(topology.weightedConnectionScore)} gewichtete Halte + ${branchScore} Abzweigung + ${endpointScore} Ende)`;
}

function formatStopStatus(topology) {
  if (!topology) return "n/a";
  if (topology.stoppingTrainrunIds.size === 0 && topology.degree > 0) return "reine Durchfahrt";
  return `${topology.stoppingTrainrunIds.size} haltende Zugfahrten`;
}

function formatTrainrunStopWeight(stats) {
  if (!stats) return "n/a";
  return `${formatNumber(stats.weight)} (${stats.stops}/${stats.traversed} Halte/Knoten)`;
}

function formatNumber(value) {
  const rounded = Math.round((value || 0) * 10) / 10;
  return Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1);
}

function formatClaudeScore(topology) {
  if (!topology?.claude) return "n/a";
  const role = topology.claude.invariant ? "hart invariant" : topology.claude.softInvariant ? "weich invariant" : "Score";
  return `LOD ${topology.claude.lod}, Score ${topology.claude.score}, Mainline ${topology.claude.mainlineScore}, ${role}`;
}

function averageMinute(timings) {
  if (!timings?.length) return null;
  let sin = 0;
  let cos = 0;
  for (const timing of timings) {
    const angle = (timing.minute / 60) * Math.PI * 2;
    sin += Math.sin(angle);
    cos += Math.cos(angle);
  }
  const angle = Math.atan2(sin / timings.length, cos / timings.length);
  return moduloMinute(Math.round((angle / (Math.PI * 2)) * 60));
}

function formatMinute(value) {
  return value == null ? "n/a" : `:${String(value).padStart(2, "0")}`;
}

function formatAverageTiming(timings) {
  return `${formatMinute(averageMinute(timings))} (${timings?.length || 0})`;
}

function updateTooltip(event) {
  if (!state.hovered) {
    tooltip.hidden = true;
    return;
  }

  const rect = canvas.getBoundingClientRect();
  tooltip.hidden = false;
  tooltip.style.left = `${event.clientX - rect.left}px`;
  tooltip.style.top = `${event.clientY - rect.top}px`;

  if (state.hovered.type === "node") {
    const node = state.hovered.item;
    const topology = state.topology.get(node.id);
    tooltip.innerHTML = `
      <strong>${escapeHtml(node.betriebspunktName || node.fullName || node.id)} (${node.id})</strong>
      <dl>
        <dt>Adrian</dt><dd>${escapeHtml(adrianRoleLabel(adrianNodeRole(node)))}</dd>
        <dt>Ø Ankunft</dt><dd>${formatAverageTiming(topology?.arrivals)}</dd>
        <dt>Ø Abfahrt</dt><dd>${formatAverageTiming(topology?.departures)}</dd>
        <dt>Umstieg</dt><dd>${formatTransfer(shortestTransfer(topology))}</dd>
        <dt>Nachbarn</dt><dd>${topology?.nonParallelEdgeCount ?? 0}</dd>
        <dt>Halte</dt><dd>${formatStopStatus(topology)}</dd>
        <dt>Jan Score</dt><dd>${formatJanScore(topology)}</dd>
        <dt>Zughalte-Score</dt><dd>${formatStopWeightScore(topology)}</dd>
        <dt>Claude</dt><dd>${formatClaudeScore(topology)}</dd>
      </dl>
    `;
  } else {
    const edge = state.hovered.item;
    tooltip.textContent = `${edge.trainrun?.name || "Trainrun"}: ${edge.source.betriebspunktName} to ${edge.target.betriebspunktName} | Zuggewicht ${formatTrainrunStopWeight(edge.trainrunStopStats)}`;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadDefaultGraph() {
  const response = await fetch(DATA_URL);
  if (!response.ok) throw new Error(`Could not load ${DATA_URL}`);
  setGraph(await response.json());
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  setGraph(JSON.parse(await file.text()));
});

lodMode.addEventListener("change", () => {
  state.lodMode = lodMode.value;
  state.hovered = null;
  invalidateVisibility();
  clearInvisibleSelection();
  updateStats();
  draw();
});

lodLevel.addEventListener("input", () => {
  state.lodLevel = Number(lodLevel.value);
  state.hovered = null;
  invalidateVisibility();
  clearInvisibleSelection();
  updateStats();
  draw();
});

adrianDelta.addEventListener("input", () => {
  state.adrianDelta = Number(adrianDelta.value) || 5;
  state.hovered = null;
  invalidateVisibility();
  clearInvisibleSelection();
  updateStats();
  updateSelection();
  draw();
});

adrianTransfer.addEventListener("input", () => {
  state.adrianTransferThreshold = Number(adrianTransfer.value) || 8;
  state.hovered = null;
  invalidateVisibility();
  clearInvisibleSelection();
  updateStats();
  updateSelection();
  draw();
});

function clearInvisibleSelection() {
  if (state.selected?.type === "node" && nodeDisplay(state.selected.item) === "hidden") {
    state.selected = null;
    updateSelection();
  }
  if (state.selected?.type === "edge" && !isEdgeVisible(state.selected.item)) {
    state.selected = null;
    updateSelection();
  }
}

searchInput.addEventListener("input", () => {
  state.searchTerm = searchInput.value.trim();
  const match = visibleNodes().find((node) => state.searchTerm && nodeMatches(node, state.searchTerm));
  if (match) {
    state.selected = { type: "node", item: match };
    const screen = toScreen({ x: match.positionX, y: match.positionY });
    state.offsetX += canvas.clientWidth / 2 - screen.x;
    state.offsetY += canvas.clientHeight / 2 - screen.y;
  }
  updateSelection();
  draw();
});

fitButton.addEventListener("click", fitGraph);

clearButton.addEventListener("click", () => {
  state.selected = null;
  state.searchTerm = "";
  searchInput.value = "";
  updateSelection();
  draw();
});

canvas.addEventListener("pointerdown", (event) => {
  canvas.setPointerCapture(event.pointerId);
  state.dragging = true;
  canvas.classList.add("dragging");
  state.dragStart = { x: event.clientX, y: event.clientY, offsetX: state.offsetX, offsetY: state.offsetY };
});

canvas.addEventListener("pointermove", (event) => {
  if (state.dragging && state.dragStart) {
    state.offsetX = state.dragStart.offsetX + event.clientX - state.dragStart.x;
    state.offsetY = state.dragStart.offsetY + event.clientY - state.dragStart.y;
    draw();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  state.hovered = nearestItem({ x: event.clientX - rect.left, y: event.clientY - rect.top });
  updateTooltip(event);
  draw();
});

canvas.addEventListener("pointerup", (event) => {
  const moved = state.dragStart && Math.hypot(event.clientX - state.dragStart.x, event.clientY - state.dragStart.y) > 4;
  state.dragging = false;
  canvas.classList.remove("dragging");
  state.dragStart = null;

  if (!moved) {
    const rect = canvas.getBoundingClientRect();
    state.selected = nearestItem({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    updateSelection();
    draw();
  }
});

canvas.addEventListener("pointerleave", () => {
  state.hovered = null;
  tooltip.hidden = true;
  draw();
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const before = toWorld(pointer);
    const factor = Math.exp(-event.deltaY * 0.001);
    state.scale = Math.max(0.005, Math.min(0.25, state.scale * factor));
    state.offsetX = pointer.x - before.x * state.scale;
    state.offsetY = pointer.y - before.y * state.scale;
    draw();
  },
  { passive: false },
);

new ResizeObserver(resizeCanvas).observe(canvas);
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", draw);

loadDefaultGraph().catch((error) => {
  selection.className = "selection";
  selection.textContent = error.message;
});
