"use client";

import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";

/** Copies the page's address and says so (shared by the Link button and the phone's Export menu). */
export async function copyPageLink(toast: (message: string) => void) {
  try {
    await navigator.clipboard.writeText(window.location.href);
    toast("Link copied");
  } catch {
    toast("Couldn't copy: use the address bar");
  }
}

/**
 * Copies the page's address, which carries the current screen (filters, sort, unticked outliers), so the view is
 * one link to send. On a phone the address bar is often hidden, hence the button. `className` adds classes
 * (`phone-folded`: hidden on phones, where the heading's Export menu offers "Copy link" instead).
 */
export function CopyLinkButton({ label = "Copy a link to this view", className }: { label?: string; className?: string }) {
  const { toast } = useUi();
  return (
    <button type="button" className={`button${className ? ` ${className}` : ""}`} onClick={() => void copyPageLink(toast)} aria-label={label} title={label}>
      <Icon name="copy" />
      Link
    </button>
  );
}
