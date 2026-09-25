export function Footer({ isSample, onAbout }: { isSample: boolean; onAbout: () => void }) {
  return (
    <footer className="flex items-center justify-between gap-5 pt-[23px] pb-[25px] text-[8px] text-[#707687] max-tablet:items-start max-phone:pt-5">
      <div>
        <span className="font-medium tracking-[0.3px] text-[#8e92a0]">CASTLE</span>
        <span className="mx-2 text-[#353944]">/</span>
        Investment banking intelligence
        <div className="mt-[3px] text-[8px] text-[#676d7d] max-phone:max-w-[280px] max-phone:text-[7px]">
          {isSample
            ? "Design preview. Fictional transactions and illustrative bank rankings. No live SEC connection."
            : "Built on public SEC EDGAR filings. Not investment advice."}
        </div>
      </div>
      <div className="flex items-center gap-[13px] max-tablet:flex-col max-tablet:items-end max-tablet:gap-[5px] max-tablet:whitespace-nowrap max-phone:gap-[7px] max-phone:text-[7px]">
        <span>
          <span className="mr-[5px] inline-block size-1 rounded-full bg-[#817492]" />
          {isSample ? "Sample snapshot" : "Live snapshot"}
        </span>
        <button type="button" onClick={onAbout} className="p-0 text-[8px] text-[#959bad] hover:text-accent max-phone:text-[7px]">
          Data &amp; methodology
        </button>
      </div>
    </footer>
  );
}
