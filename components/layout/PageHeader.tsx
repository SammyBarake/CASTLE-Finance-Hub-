import { Icon } from "@/components/ui/Icon";
import { formatDateFull } from "@/lib/format";

export function PageHeader({ asOf, onExport }: { asOf: string; onExport: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-5 max-laptop:gap-2.5 max-phone:mb-[19px]">
      <div>
        <div className="mb-[7px] flex items-center gap-[7px] text-[10px] text-dim max-phone:text-[9px]">
          Workspace <Icon name="chevron" className="!size-2.5" />
          <strong className="font-normal text-[#aaaebc]">Hub</strong>
        </div>
        <h1 className="text-[27px] leading-[1.3] font-[550] tracking-[-0.85px] max-phone:text-[24px]">Market overview</h1>
        <p className="mt-[5px] mb-0 text-[11px] text-muted max-phone:max-w-[265px] max-phone:text-[10px]">
          The transactions, people, and signals moving investment banking.
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <span className="flex items-center gap-[7px] rounded-[5px] border border-line px-2.5 py-[7px] text-[10px] text-[#a8acb9] max-laptop:hidden">
          <Icon name="calendar" className="!size-[13px]" />
          {formatDateFull(asOf)}
        </span>
        <button type="button" className="btn max-phone:p-2 max-phone:[&_.icon]:!size-[15px]" onClick={onExport} aria-label="Export deals as CSV">
          <Icon name="download" />
          <span className="max-phone:hidden">Export deals</span>
        </button>
      </div>
    </div>
  );
}
