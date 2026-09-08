# Ansatz Martin

Dieses Dokument beschreibt die aktuelle Implementierung von `Ansatz Martin` im Network Graphic Viewer.

## Ziel

`Ansatz Martin` ist ein morphologisch orientierter Level-of-Detail-Ansatz. Er soll die geografische und topologische Gestalt des Graphen möglichst stabil halten, während weniger wichtige Knoten visuell reduziert oder ausgeblendet werden.

Der Ansatz optimiert bewusst nicht nach Fahrplanqualität, Verkehrsgewicht oder Umstiegsbedeutung. Die zentrale Frage lautet:

```text
Welche Knoten werden benötigt, um die sichtbare Netzstruktur zu verstehen?
```

## Verfügbare Level

Martin verwendet nur noch die Level 2 bis 5. Level 1 wurde entfernt, weil die resultierende Darstellung für den aktuellen Graphen zu stark reduziert und dadurch fachlich wenig hilfreich war.

### Level 5

Alle Bahnhöfe werden als benannte Boxen angezeigt.

Regeln:

- jeder Knoten mit mindestens einer aktiven Kante ist sichtbar
- jeder sichtbare Knoten wird als Box dargestellt
- alle nach Kategorien gefilterten Zuglaufabschnitte werden gezeichnet

### Level 4

Gewöhnliche Durchgangsknoten werden zu Punkten reduziert. Knoten, an denen ein Zuglauf auf einer ansonsten linearen Strecke beginnt oder endet, bleiben als Box sichtbar.

Regeln:

- echte Graph-Endpunkte sind als Box sichtbar
- Abzweigungen sind als Box sichtbar
- Linienbeginn/-ende auf einer Kante sind als Box sichtbar
- gewöhnliche Durchgangshalte sind als Punkte sichtbar
- alle nach Kategorien gefilterten Zuglaufabschnitte werden gezeichnet

### Level 3

Wie Level 4, aber Linienbeginn/-ende auf einer Kante werden nicht mehr als Box hervorgehoben.

Regeln:

- echte Graph-Endpunkte sind als Box sichtbar
- Abzweigungen sind als Box sichtbar
- Linienbeginn/-ende auf einer Kante sind als Punkte sichtbar
- gewöhnliche Durchgangshalte sind als Punkte sichtbar
- alle nach Kategorien gefilterten Zuglaufabschnitte werden gezeichnet

### Level 2

Nur noch strukturelle Graphknoten bleiben sichtbar.

Regeln:

- echte Graph-Endpunkte sind als Box sichtbar
- Abzweigungen sind als Box sichtbar
- Linienbeginn/-ende auf einer Kante werden ausgeblendet
- gewöhnliche Durchgangshalte werden ausgeblendet
- alle nach Kategorien gefilterten Zuglaufabschnitte bleiben Teil der Ansicht
- die Kanten werden für die Darstellung zu direkten visuellen Korridoren zwischen den verbleibenden sichtbaren Knoten zusammengeführt

## Kategorienfilter

Der Filter auf Zugtypen beziehungsweise Kategorien wird vor der Martin-LOD-Logik angewendet.

Wenn eine Kategorie deaktiviert wird:

- werden ihre Zuglaufabschnitte aus dem aktiven Graphen entfernt
- wird die Topologie aus den verbleibenden Abschnitten neu berechnet
- werden Rollen wie Endpunkt, Durchgangsknoten und Abzweigung neu bestimmt
- wird die sichtbare LOD-Ansicht aus der gefilterten Topologie neu aufgebaut

Ein Knoten kann dadurch seine Rolle ändern. Eine Abzweigung kann zum Beispiel zu einem gewöhnlichen Durchgangsknoten werden, wenn die abgewählte Kategorie der einzige Grund für einen dritten Nachbarn war.

## Topologische Rollen

Die primäre Topologieanalyse basiert auf dem gefilterten Quellgraphen.

### Echter Graph-Endpunkt

Ein Knoten ist ein echter Graph-Endpunkt, wenn er im gefilterten Graphen genau einen unterschiedlichen Nachbarknoten hat.

```text
Anzahl unterschiedlicher Nachbarn = 1
```

### Abzweigung

Ein Knoten ist eine Abzweigung, wenn er im gefilterten Graphen mindestens drei unterschiedliche Nachbarknoten hat.

```text
Anzahl unterschiedlicher Nachbarn >= 3
```

Geometrische Winkel definieren keine Abzweigung. Ein Knoten mit genau zwei Nachbarn bleibt ein Durchgangsknoten, auch wenn die Linie dort um 90 Grad abknickt.

### Durchgangsknoten

Ein Knoten ist ein Durchgangsknoten, wenn er weder echter Graph-Endpunkt noch Abzweigung ist.

```text
Anzahl unterschiedlicher Nachbarn = 2
```

### Linienbeginn/-ende auf einer Kante

Ein Knoten ist Linienbeginn/-ende auf einer Kante, wenn mindestens ein aktiver Zuglauf an diesem Knoten beginnt oder endet, der Knoten selbst aber kein struktureller Graph-Endpunkt ist.

Diese Rolle ist vor allem für Level 4 und Level 3 relevant:

- in Level 4 bleiben solche Knoten als Box sichtbar
- in Level 3 werden sie zu Punkten reduziert

## Halt vs. Durchfahrt

Zusätzlich zur Topologierolle wird ausgewertet, ob aktive Zugläufe an einem Knoten halten oder ihn nur durchfahren.

Bei Punktdarstellung gilt:

- ein gefüllter Punkt bedeutet, dass mindestens ein aktiver Zuglauf an diesem Knoten hält
- ein leerer Punkt bedeutet, dass der Knoten ein reiner Durchfahrtsknoten ist

Bei Boxdarstellung gilt:

- eine normale Box steht für einen Knoten, an dem mindestens ein aktiver Zuglauf hält
- eine gedämpfte gestrichelte Box steht für einen reinen Durchfahrtsknoten

Reine Durchfahrtsknoten können weiterhin topologisch wichtig sein. Sie werden deshalb nicht automatisch entfernt, nur weil dort kein Zug hält.

## Aktuelles Morphologiemodell

Der Viewer berechnet zusätzlich ein aktuelles Morphologiemodell für den aktiven LOD.

Dafür werden ausgeblendete Zwischenknoten zu sichtbaren Korridoren kontrahiert. Anschließend werden die sichtbaren Knoten im reduzierten Graphen klassifiziert:

- `aktuelle Abzweigung`: verbindet mindestens drei sichtbare Korridore
- `echtes Netzende`: ist ein Endpunkt im gefilterten Quellgraphen
- `Linienbeginn/-ende auf Kante`: ein Zuglauf beginnt oder endet an einem inline liegenden Knoten
- `temporäres LOD-Ende`: wirkt nur durch die aktuelle Reduktion wie ein Endpunkt
- `Durchgangshalt`: Durchgangsknoten, an dem mindestens ein aktiver Zuglauf hält
- `reine Durchfahrt`: Durchgangsknoten, an dem kein aktiver Zuglauf hält

Diese Rollen erscheinen im Tooltip und im Auswahlpanel. Sie werden auch visuell genutzt:

- aktuelle Abzweigungen erhalten einen dezenten Fokus-Halo
- temporäre LOD-Enden werden gedämpft und gestrichelt dargestellt
- reine Durchfahrtsknoten werden leer oder gestrichelt dargestellt

## Kanten-Rendering

Datenmodell und Darstellungsmodell sind absichtlich getrennt.

Das Datenmodell behält die originalen Zuglaufabschnitte. Dadurch bleiben Filterung, Scores, Zeitinformationen und Tooltips auf den Originaldaten korrekt.

Das Darstellungsmodell entscheidet, wie Kanten im Canvas gezeichnet werden.

### Level 3 bis 5

Level 3, 4 und 5 zeichnen die originalen Zuglaufabschnitte.

In diesen Leveln sind keine oder nur wenige Knoten ausgeblendet, daher bleibt die originale Abschnittsgeometrie gut lesbar.

### Level 2

Level 2 fasst aufeinanderfolgende Zuglaufabschnitte zu visuellen Korridoren zwischen den verbleibenden sichtbaren Knoten zusammen.

Die Positionen der Knoten werden nicht verändert. Nur die Kantengeometrie wird neu gezeichnet:

```text
sichtbarer Knoten A -- ausgeblendeter Knoten -- ausgeblendeter Knoten -- sichtbarer Knoten B
```

wird zu:

```text
sichtbarer Knoten A -------------------------------------------- sichtbarer Knoten B
```

Mehrere Zugläufe auf demselben Korridor bleiben als parallele Linien sichtbar. Der Viewer versetzt sie leicht, damit das Linienbündel lesbar bleibt.

Wenn ein zusammengefasster Korridor ausgeblendete Zwischenknoten überspringt, wird auf dem Korridor ein kleines Badge gezeichnet. Die Zahl im Badge ist die Anzahl der ausgeblendeten Zwischenknoten auf diesem zusammengefassten Korridor.

## Konnektivitätsprinzip

Martin soll die visuelle Verbundenheit des Netzes erhalten.

Wenn Knoten ausgeblendet werden, werden die verbindenden Zuglaufabschnitte nicht einfach entfernt. Sichtbare Knoten bleiben über den ausgeblendeten Zwischenpfad verbunden. In Level 2 wird dieser Pfad als direkter Korridor gerendert.

Dadurch werden disjunkte Graphfragmente vermieden, die nur durch die LOD-Reduktion entstehen würden.

## Implementierung

Die zentrale Implementierung liegt in `app.js`.

Wichtige Funktionen:

- `baseNodeDisplay(node)`: entscheidet, ob ein Martin-Knoten als Box, Punkt oder ausgeblendet dargestellt wird
- `computeVisibleEdgeIdsForNodeIds(visibleNodeIds)`: hält für Martin die aktiven gefilterten Zuglaufabschnitte sichtbar
- `computeRenderEdges()`: erzeugt für Martin Level 2 zusammengefasste Render-Korridore
- `computeTrainrunRenderCorridors(...)`: folgt einem Zuglauf durch ausgeblendete Knoten bis zum nächsten sichtbaren Knoten
- `offsetRenderCorridors(corridors)`: versetzt parallele Korridorlinien und entscheidet, wo das Badge für ausgeblendete Zwischenknoten erscheint
- `currentMorphology()`: berechnet Rollen aus dem aktuellen reduzierten Graphen

## Bekannte Grenzen

Die aktuelle Korridor-Zusammenführung folgt jedem Zuglauf einzeln. Dadurch bleiben mehrere Linien sichtbar, aber sehr dicht befahrene Korridore können weiterhin viele parallele Striche erzeugen.

Das Badge zählt übersprungene Knoten, nicht physische Abstände und nicht die Anzahl einzelner grafischer Lücken. Es ist ein topologischer Zähler.
