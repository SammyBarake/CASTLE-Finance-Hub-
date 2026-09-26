import { SECTORS, type Sector } from "./types";

/** Display colour per sector. UI config, not data. */
export const SECTOR_COLORS: Record<Sector, string> = {
  Tech: "#dedede",
  Healthcare: "#72ad95",
  Energy: "#b49c75",
  Financials: "#819fb5",
  Industrials: "#969696",
};

export const sectorColor = (sector: Sector) => SECTOR_COLORS[sector];

export { SECTORS };
