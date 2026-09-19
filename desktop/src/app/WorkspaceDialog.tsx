import { useEffect, useRef, type ReactNode } from "react";

/** Native modal semantics provide focus trapping and restore the opener on close. */
export function WorkspaceDialog({
  children,
  label,
  onClose,
  className = "",
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    dialog.showModal();
    return () => {
      dialog.close();
      // The home composer moves into the sheet while it is open. Restore its
      // replacement after React has committed the home view again.
      requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
        else document.querySelector<HTMLElement>(".composer-mascot")?.focus();
      });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`workspace-dialog ${className}`}
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
