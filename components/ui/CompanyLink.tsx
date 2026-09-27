"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { companyHref, hasCompanyPage } from "@/lib/companies";
import type { Company } from "@/lib/types";
import { useUi } from "./UiProvider";

/** Link to a company page. Closes any open drawer and never triggers the row it sits in. */
export function CompanyLink({ company, className = "company-link", children }: { company: Company; className?: string; children?: ReactNode }) {
  const { closeDialog } = useUi();
  if (!hasCompanyPage(company)) return <span>{children ?? company.name}</span>;
  return (
    <Link
      className={className}
      href={companyHref(company)}
      onClick={(e) => {
        e.stopPropagation();
        closeDialog();
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {children ?? company.name}
    </Link>
  );
}
