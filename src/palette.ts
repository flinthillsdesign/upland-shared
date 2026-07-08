// ── Shared data-series colors ────────────────────────────────────────────
// The design/fab dialect both apps speak: the scheduler's overview stacked
// columns and ODIN's retro shape chart use the SAME hues so the two
// surfaces read as one system. (Brand/visual identity assets stay in
// upland-workshop — this is chart-series color only.)

export const TEAM_COLORS = {
  design: "#b6d7ea", // design beneath
  fab: "#7fafc4", // fabrication on top
} as const;

// Install-month accent (bands, ticks, axis labels on retro charts).
export const INSTALL_ACCENT = "#d97706";
