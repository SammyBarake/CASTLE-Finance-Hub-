import { SECTORS, type Sector } from "./types";

/** Display colour per sector. UI config, not data. */
export const SECTOR_COLORS: Record<Sector, string> = {
  Tech: "#aaa3ef",
  Healthcare: "#77b6a7",
  Energy: "#bca277",
  Financials: "#799cce",
  Industrials: "#b18eaa",
};

export const sectorColor = (sector: Sector) => SECTOR_COLORS[sector];

export { SECTORS };
