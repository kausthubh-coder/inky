import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus trapping and restore the opener on close. */
export function WorkspaceDialog({ children, label, onClose }: { children: ReactNode; label: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => { dialog.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  return <dialog ref={ref} className="workspace-dialog" aria-label={label} onCancel={event => { event.preventDefault(); onClose(); }}>
    {children}
  </dialog>;
}
