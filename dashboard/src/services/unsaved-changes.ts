import { inject, onUnmounted, type InjectionKey } from "vue";

type EditorState = { dirty: () => boolean; busy: () => boolean };
export function createUnsavedChanges(confirm: (message: string) => boolean, notify: (message: string) => void) {
  const editors = new Set<EditorState>();
  const needsWarning = () => [...editors].some(editor => editor.dirty() || editor.busy());
  return {
    register(editor: EditorState) { editors.add(editor); return () => { editors.delete(editor); }; },
    allowLeave() {
      if ([...editors].some(editor => editor.busy())) { notify("Wait for the current request to finish before leaving."); return false; }
      return !needsWarning() || confirm("You have unsaved changes. Discard them and leave this page?");
    },
    beforeUnload(event: BeforeUnloadEvent) {
      if (!needsWarning()) return;
      event.preventDefault(); event.returnValue = "";
    },
  };
}
export const unsavedChangesKey: InjectionKey<ReturnType<typeof createUnsavedChanges>> = Symbol("unsavedChanges");
export function useUnsavedChanges(dirty: () => boolean, busy: () => boolean) {
  const guard = inject(unsavedChangesKey, undefined);
  const remove = guard?.register({ dirty, busy });
  onUnmounted(() => remove?.());
}
