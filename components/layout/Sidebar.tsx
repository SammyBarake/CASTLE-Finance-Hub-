"use client";

import { Icon, type IconName } from "@/components/ui/Icon";

export type NavId = "hub" | "deal-flow" | "deal-volume" | "ipo-pipeline" | "advisors" | "valuations";

const NAV: { id: NavId; label: string; icon: IconName }[] = [
  { id: "hub", label: "Hub", icon: "grid" },
  { id: "deal-flow", label: "Deal Flow", icon: "flow" },
  { id: "deal-volume", label: "Deal Volume", icon: "chart" },
  { id: "ipo-pipeline", label: "IPO Pipeline", icon: "ipo" },
  { id: "advisors", label: "Advisors", icon: "bank" },
  { id: "valuations", label: "Valuations", icon: "values" },
];

const navLink =
  "relative flex w-full items-center gap-[11px] whitespace-nowrap rounded-[5px] px-[13px] py-2.5 text-left text-[12px] font-medium text-[#999dac] transition-colors max-laptop:gap-[9px] max-laptop:px-2.5 max-laptop:text-[11px] max-tablet:text-[10px] max-phone:text-[12px]";

/** The castle mark. The only place the castle appears. */
export function Logo() {
  return (
    <svg viewBox="0 0 30 32" aria-hidden="true" className="h-[29px] w-[27px] fill-none stroke-fg stroke-[1.65] [stroke-linejoin:round]">
      <path d="M4 28V9h5V4h4v5h4V4h4v5h5v19H4Z" />
      <path d="M4 16h22M12 28v-7h6v7" />
    </svg>
  );
}

export function Sidebar({
  open,
  active,
  dealCount,
  onNavigate,
  onAbout,
  onSoon,
}: {
  open: boolean;
  active: NavId;
  dealCount: number;
  onNavigate: (id: NavId) => void;
  onAbout: () => void;
  onSoon: (feature: string) => void;
}) {
  return (
    <aside
      id="sidebar"
      aria-label="Primary navigation"
      className={`fixed inset-y-0 left-0 z-50 flex w-[208px] flex-col border-r border-line bg-sidebar px-3.5 max-laptop:w-[182px] max-laptop:px-2.5 max-tablet:w-[171px] max-phone:w-[208px] max-phone:transition-transform max-phone:duration-200 ${
        open ? "" : "max-phone:-translate-x-full"
      }`}
    >
      <a
        href="#hub"
        onClick={() => onNavigate("hub")}
        aria-label="Castle home"
        className="flex h-[82px] items-center gap-[11px] px-3.5 text-[25px] font-semibold tracking-[-1.05px] max-laptop:px-2.5 max-tablet:text-[24px] max-phone:text-[25px]"
      >
        <Logo />
        Castle<span className="text-accent">.</span>
      </a>

      <div className="mx-[5px] mt-[7px] mb-[27px] flex items-center gap-[9px] rounded-[5px] border border-line bg-[#14161c] p-[9px] text-[11px] whitespace-nowrap text-[#c4c7d1] max-tablet:mb-[25px] max-tablet:p-2 max-tablet:text-[9px] max-phone:text-[11px]">
        <span className="grid size-[23px] place-items-center rounded bg-[#262332] text-[10px] font-semibold text-[#c8c3f4]">C</span>
        Investment Banking
        <Icon name="bank" className="ml-auto !w-[13px] text-dim" />
      </div>

      <div className="mb-3 px-[13px] text-[9px] font-semibold tracking-[1.5px] text-dim">WORKSPACE</div>
      <nav className="flex flex-col gap-[5px]">
        {NAV.map((item) => {
          const isActive = item.id === active;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              onClick={() => onNavigate(item.id)}
              aria-current={isActive ? "location" : undefined}
              className={`${navLink} ${
                isActive
                  ? "bg-accent-bg text-[#c9c2ff] before:absolute before:top-[11px] before:bottom-[11px] before:-left-3.5 before:w-0.5 before:bg-accent before:content-[''] max-laptop:before:-left-2.5"
                  : "hover:bg-[#191b22] hover:text-fg"
              }`}
            >
              <Icon name={item.icon} className="!size-[17px] max-tablet:!w-[15px] max-phone:!w-[17px]" />
              {item.label}
              {item.id === "deal-flow" && (
                <span className="ml-auto rounded-[3px] border border-[#30323d] bg-[#242631] px-[5px] text-[9px] text-[#a5a9b7]">{dealCount}</span>
              )}
            </a>
          );
        })}
        <button type="button" className={`${navLink} opacity-60 hover:opacity-80`} onClick={() => onSoon("World Economies")} aria-describedby="economies-soon">
          <Icon name="globe" className="!size-[17px] max-tablet:!w-[15px] max-phone:!w-[17px]" />
          World Economies
          <span id="economies-soon" className="ml-auto rounded-[3px] border border-[#3b384c] px-1 py-px text-[8px] tracking-[0.6px] text-[#b6aecf] uppercase">
            Soon
          </span>
        </button>
      </nav>

      <div className="mt-auto pb-[18px]">
        <div className="mx-1 mb-[22px] rounded-[5px] border border-line px-3 py-[13px]">
          <div className="eyebrow !text-[9px] !tracking-[1.2px] !text-[#a4a0be]">Built on public filings</div>
          <p className="mt-[7px] mb-2.5 text-[10px] leading-[1.65] text-dim">
            Follow the transactions.
            <br />
            Understand the market.
          </p>
          <button type="button" onClick={onAbout} className="inline-flex items-center gap-[5px] p-0 text-[11px] text-accent hover:text-[#ddd7ff]">
            Inside the data <Icon name="right" className="!size-3" />
          </button>
        </div>
        <div className="flex items-center gap-2.5 border-t border-line px-2 pt-[17px]">
          <div className="grid size-[30px] place-items-center rounded-full border border-[#383a48] bg-[#242632] text-[10px] font-semibold text-[#c5c4d1]">CA</div>
          <div className="whitespace-nowrap">
            <div className="text-[11px] font-medium">Castle Analyst</div>
            <div className="mt-px text-[9px] text-dim">Personal workspace</div>
          </div>
          <span className="ml-auto rounded-[3px] border border-[#3b384c] px-1 py-0.5 text-[8px] tracking-[0.6px] text-[#b6aecf] uppercase">Preview</span>
        </div>
      </div>
    </aside>
  );
}
