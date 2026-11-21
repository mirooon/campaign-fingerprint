"use client";

import { useEffect, useRef } from "react";
import type { Core, ElementDefinition, LayoutOptions, StylesheetJson } from "cytoscape";

let fcoseRegistered = false;

const STYLE: StylesheetJson = [
  {
    selector: "node",
    style: {
      "background-color": "data(color)",
      label: "data(label)",
      width: "data(size)",
      height: "data(size)",
      "font-size": 8,
      color: "#334155",
      "text-valign": "bottom",
      "text-margin-y": 3,
      "text-wrap": "ellipsis",
      "text-max-width": "110px",
      "border-width": 1,
      "border-color": "#ffffff",
    },
  },
  {
    selector: "node.item",
    style: { shape: "round-rectangle", "font-size": 9, "font-weight": "bold", color: "#0f172a" },
  },
  { selector: "node.strong", style: { "border-width": 2, "border-color": "#0f172a" } },
  { selector: "node.discounted", style: { opacity: 0.55, "border-style": "dashed", "border-width": 2, "border-color": "#64748b" } },
  {
    selector: "edge",
    style: {
      width: "mapData(weight, 0, 1, 0.6, 2.4)",
      "line-color": "#cbd5e1",
      "curve-style": "bezier",
      opacity: 0.9,
    },
  },
  { selector: "edge.to-discounted", style: { "line-style": "dotted", opacity: 0.5 } },
  { selector: "edge.similar_image", style: { "line-color": "#0d9488", "line-style": "dashed", width: 2 } },
  { selector: "edge.similar_image_semantic", style: { "line-color": "#14b8a6", "line-style": "dotted", width: 1.8 } },
  { selector: "edge.similar_text", style: { "line-color": "#6366f1", "line-style": "dashed", width: 1.6 } },
  { selector: "edge.similar_dom", style: { "line-color": "#d97706", "line-style": "dashed", width: 1.4, opacity: 0.7 } },
  { selector: "edge.similar_audio", style: { "line-color": "#c026d3", "line-style": "dotted", width: 2 } },
  { selector: "edge.similar_voice", style: { "line-color": "#0d9488", "line-style": "dotted", width: 1.6, opacity: 0.8 } },
  { selector: "edge.redirect", style: { "line-color": "#94a3b8", "target-arrow-shape": "triangle", "target-arrow-color": "#94a3b8", "arrow-scale": 0.7 } },
  { selector: ".faded", style: { opacity: 0.12 } },
  { selector: "node.marked", style: { "border-width": 4, "border-color": "#7c3aed", opacity: 1 } },
  { selector: "node.selected", style: { "border-width": 4, "border-color": "#f59e0b", opacity: 1 } },
];

export interface GraphCanvasProps {
  elements: ElementDefinition[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Shift+click on a node (used to pick ads for comparison). */
  onShiftSelect?: (id: string) => void;
  /** Nodes outlined in violet (the two ads being compared). */
  markedIds?: string[];
}

export default function GraphCanvas({ elements, selectedId, onSelect, onShiftSelect, markedIds = [] }: GraphCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const onSelectRef = useRef(onSelect);
  const onShiftSelectRef = useRef(onShiftSelect);
  const selectedRef = useRef(selectedId);
  const markedKey = markedIds.join("\u0000");
  const markedRef = useRef(markedKey);

  useEffect(() => {
    onSelectRef.current = onSelect;
    onShiftSelectRef.current = onShiftSelect;
  }, [onSelect, onShiftSelect]);

  // (Re)create the graph whenever the element set changes.
  useEffect(() => {
    let cancelled = false;
    let cy: Core | null = null;
    void (async () => {
      const cytoscape = (await import("cytoscape")).default;
      const fcose = (await import("cytoscape-fcose")).default;
      if (cancelled || !containerRef.current) return;
      if (!fcoseRegistered) {
        cytoscape.use(fcose);
        fcoseRegistered = true;
      }
      cy = cytoscape({
        container: containerRef.current,
        elements,
        style: STYLE,
        minZoom: 0.08,
        maxZoom: 3,
        boxSelectionEnabled: false,
      });
      cy.on("tap", "node", (evt) => {
        const shift = (evt.originalEvent as MouseEvent | undefined)?.shiftKey === true;
        if (shift && onShiftSelectRef.current) onShiftSelectRef.current(evt.target.id());
        else onSelectRef.current(evt.target.id());
      });
      cy.on("tap", (evt) => {
        if (evt.target === cy) onSelectRef.current(null);
      });
      const layout = {
        name: "fcose",
        quality: "default",
        randomize: true,
        animate: false,
        nodeRepulsion: () => 9000,
        idealEdgeLength: () => 60,
        nodeSeparation: 70,
        packComponents: true,
        padding: 30,
      } as unknown as LayoutOptions;
      cy.layout(layout).run();
      cyRef.current = cy;
      mark(cy, markedRef.current);
      highlight(cy, selectedRef.current, true);
    })();
    return () => {
      cancelled = true;
      cy?.destroy();
      cyRef.current = null;
    };
  }, [elements]);

  useEffect(() => {
    selectedRef.current = selectedId;
    if (cyRef.current) highlight(cyRef.current, selectedId, true);
  }, [selectedId]);

  useEffect(() => {
    markedRef.current = markedKey;
    if (cyRef.current) mark(cyRef.current, markedKey);
  }, [markedKey]);

  return <div ref={containerRef} className="h-full w-full" aria-label="Graf powiązań reklam" role="img" />;
}

function mark(cy: Core, markedKey: string) {
  cy.nodes().removeClass("marked");
  for (const id of markedKey ? markedKey.split("\u0000") : []) cy.getElementById(id).addClass("marked");
}

function highlight(cy: Core, id: string | null, center = false) {
  cy.elements().removeClass("faded selected");
  if (!id) return;
  const node = cy.getElementById(id);
  if (node.empty()) return;
  const hood = node.closedNeighborhood();
  cy.elements().not(hood).addClass("faded");
  node.addClass("selected");
  if (center) cy.animate({ fit: { eles: hood, padding: 110 } }, { duration: 300 });
}
