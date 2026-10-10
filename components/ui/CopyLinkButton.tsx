"use client";

import { Icon } from "@/components/ui/Icon";
import { useUi } from "@/components/ui/UiProvider";

/**
 * Copies the page's address, which carries the current screen (filters, sort, unticked outliers), so the view is
 * one link to send. On a phone the address bar is often hidden, hence the button.
 */
export function CopyLinkButton({ label = "Copy a link to this view" }: { label?: string }) {
  const { toast } = useUi();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast("Link copied");
    } catch {
      toast("Couldn't copy: use the address bar");
    }
  };
  return (
    <button type="button" className="button" onClick={copy} aria-label={label} title={label}>
      <Icon name="copy" />
      Link
    </button>
  );
}
