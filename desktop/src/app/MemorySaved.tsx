import { useState } from "react";
import { Icon } from "./Icon.js";

/** "Saved to memory" in a thread, with Undo. It shows up on the memory page too. */
export function MemorySaved({ title, noteId }: { title: string; noteId?: string }) {
  const [gone, setGone] = useState(false);
  const undo = async () => {
    const notes = await window.studi!.listMemories();
    const note = notes.find((item) => (noteId ? item.noteId === noteId : item.title === title));
    if (note) await window.studi!.deleteMemory({ noteId: note.noteId, expectedRevision: note.revision });
    setGone(true);
  };
  return <p className="ag-mem"><Icon name="check" size={13} />{gone ? `Forgot “${title}”.` : <>Saved to memory: “{title}” · <button className="rd-link" onClick={() => void undo()}>Undo</button></>}</p>;
}
