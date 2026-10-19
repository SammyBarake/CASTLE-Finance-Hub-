import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * A full-page message outside the terminal shell: the 404 page and the error fallbacks. The logo, a short code, a
 * title, one line of explanation and a few ways back in.
 */
export function StatusPage({ code, title, children, actions }: { code: string; title: string; children: ReactNode; actions: ReactNode }) {
  return (
    <main className="status-page">
      <div className="status-card">
        <Link href="/" className="status-logo" aria-label="Castle home">
          <Image src="/castle-logo.png" alt="Castle" width={137} height={105} priority />
        </Link>
        <p className="status-code">{code}</p>
        <h1>{title}</h1>
        <div className="status-text">{children}</div>
        <div className="status-actions">{actions}</div>
      </div>
    </main>
  );
}
