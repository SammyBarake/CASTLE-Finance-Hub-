import type { Metadata } from "next";
import Link from "next/link";
import { StatusPage } from "@/components/shell/StatusPage";

export const metadata: Metadata = { title: "Page not found · Castle" };

/** Unknown addresses, and pages for a deal or company that doesn't exist (notFound()). */
export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="Page not found"
      actions={
        <>
          <Link className="button primary" href="/hub">
            Go to the Hub
          </Link>
          <Link className="button" href="/deal-flow">
            Deal Flow
          </Link>
          <Link className="button" href="/ipo-pipeline">
            IPO Pipeline
          </Link>
        </>
      }
    >
      <p>This address doesn&apos;t match a page on Castle. The deal or company may have been merged into another record, or the link may be mistyped.</p>
    </StatusPage>
  );
}
