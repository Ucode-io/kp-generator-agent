export const ARCHITECTURE_LAYER_DEFINITIONS = Object.freeze([
  Object.freeze({ id: "ARCH-LAYER-USERS", key: "users", label: "User types", nodeTypes: Object.freeze(["surface"]) }),
  Object.freeze({ id: "ARCH-LAYER-PLATFORMS", key: "platforms", label: "User platforms", nodeTypes: Object.freeze(["channel"]) }),
  Object.freeze({ id: "ARCH-LAYER-BACKEND", key: "backend", label: "Backend", nodeTypes: Object.freeze(["application", "service"]) }),
  Object.freeze({ id: "ARCH-LAYER-DATA", key: "data", label: "Databases", nodeTypes: Object.freeze(["data_store"]) }),
  Object.freeze({ id: "ARCH-LAYER-INTEGRATIONS", key: "integrations", label: "Integrations", nodeTypes: Object.freeze(["external_system"]) }),
]);

export const ARCHITECTURE_LAYER_ORDER = Object.freeze(ARCHITECTURE_LAYER_DEFINITIONS.map((layer) => layer.id));

const TYPE_TO_LAYER = new Map(ARCHITECTURE_LAYER_DEFINITIONS.flatMap((layer) => layer.nodeTypes.map((type) => [type, layer.id])));

export function architectureLayerIdForNode(node = {}) {
  if (ARCHITECTURE_LAYER_ORDER.includes(node.lane)) return node.lane;
  if (TYPE_TO_LAYER.has(node.type)) return TYPE_TO_LAYER.get(node.type);
  const text = `${node.id || ""} ${node.label || ""}`;
  if (/user|actor|role/i.test(text)) return "ARCH-LAYER-USERS";
  if (/channel|platform|interface/i.test(text)) return "ARCH-LAYER-PLATFORMS";
  if (/data|database|store/i.test(text)) return "ARCH-LAYER-DATA";
  if (/integration|external|partner/i.test(text)) return "ARCH-LAYER-INTEGRATIONS";
  return "ARCH-LAYER-BACKEND";
}
