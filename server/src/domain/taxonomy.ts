// Controlled vocabularies shared by the synthetic spec, the extraction step and the query filters.
// Using fixed enums (instead of free text) is what makes the catalog filterable.

export const CLIENT_TYPES = [
  "federal",
  "provincial",
  "municipal",
  "broader_public_sector", // school boards, hospitals, colleges, public agencies
  "private",
] as const;

export const SECTORS = [
  "bridge_structure",
  "k12_school",
  "post_secondary",
  "healthcare",
  "water_wastewater",
  "roads_utilities",
  "transit_rail",
  "recreation",
  "civic_institutional",
  "emergency_services",
  "commercial",
  "industrial",
  "residential_mixed_use",
  "parking",
] as const;

export const DELIVERY_METHODS = [
  "design_bid_build",
  "design_build",
  "construction_management",
  "p3",
] as const;

export const DOC_TYPES = [
  "contract_summary",
  "change_order_log",
  "meeting_minutes",
  "completion_report",
  "reference_letter",
] as const;

export type ClientType = (typeof CLIENT_TYPES)[number];
export type Sector = (typeof SECTORS)[number];
export type DeliveryMethod = (typeof DELIVERY_METHODS)[number];
export type DocType = (typeof DOC_TYPES)[number];
