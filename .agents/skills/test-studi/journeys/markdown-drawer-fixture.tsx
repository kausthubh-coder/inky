// The older drawer has no current navigation entry. Mount its actual component for QA.
import { createRoot } from "react-dom/client";
import { DeskDrawer } from "../../../../desktop/src/app/DeskScreen.js";

export async function mountMarkdownDrawer(text: string) {
  const api = window.studi!;
  const [onboarding, workspace, lifecycle] = await Promise.all([
    api.getSchoolOnboardingState(), api.getWorkspaceState(), api.getLifecycleState(),
  ]);
  document.getElementById("root")!.hidden = true;
  const host = document.body.appendChild(document.createElement("div"));
  const noop = () => {};
  createRoot(host).render(<DeskDrawer panel={{ kind: "desk" }} onboarding={onboarding} workspace={workspace}
    lifecycle={{ ...lifecycle, execution: null }} detail={null} assignment={null} task={null}
    showingLiveDesk={false} busy={null} error={null}
    talk={[{ who: "you", text: "Keep **this** as typed." }, { who: "inky", text }]}
    onClose={noop} onStart={noop} onTalk={noop} onTakeover={noop} onResume={noop} onCancel={noop}
    onVerifySubmission={noop} onOpenArtifact={noop} onConnectRuntime={noop} onSchoolSlot={noop} />);
}
