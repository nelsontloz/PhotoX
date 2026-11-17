import { useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';

/** Props for the rename `<input>`; spread onto it and pass the header's own className. */
export interface InlineRenameInputProps {
  autoFocus: true;
  value: string;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onBlur: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * Inline click-to-rename state machine shared by the album/person headers.
 *
 * `currentName` is the committed name from parent state (seed + revert target).
 * `commit` performs the mutation and updates parent state; on throw the value reverts.
 * `allowEmpty` lets `commit('')` through (person names are clearable); otherwise
 * empty input just closes without a call. `cancelOnEscape` adds Escape as a revert key.
 */
export function useInlineRename(
  currentName: string,
  commit: (name: string) => Promise<void>,
  opts?: { allowEmpty?: boolean; cancelOnEscape?: boolean },
): {
  editing: boolean;
  nameValue: string;
  setNameValue: (v: string) => void;
  start: () => void;
  save: () => Promise<void>;
  cancel: () => void;
  inputProps: InlineRenameInputProps;
} {
  const [editing, setEditing] = useState(false);
  const [nameValue, setNameValue] = useState(currentName);
  // ponytail: re-entry guard only (Enter unmounts the input mid-save and blur can re-fire save)
  const busy = useRef(false);

  const start = () => {
    setNameValue(currentName);
    setEditing(true);
  };

  const cancel = () => {
    setNameValue(currentName);
    setEditing(false);
  };

  const save = async () => {
    if (busy.current) return;
    const trimmed = nameValue.trim();
    if (trimmed === currentName || (trimmed === '' && !opts?.allowEmpty)) {
      cancel();
      return;
    }
    busy.current = true;
    try {
      await commit(trimmed);
    } catch {
      setNameValue(currentName);
    } finally {
      busy.current = false;
      setEditing(false);
    }
  };

  const inputProps: InlineRenameInputProps = {
    autoFocus: true,
    value: nameValue,
    onChange: (e) => setNameValue(e.target.value),
    onBlur: () => {
      void save();
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter') void save();
      if (e.key === 'Escape' && opts?.cancelOnEscape) cancel();
    },
  };

  return { editing, nameValue, setNameValue, start, save, cancel, inputProps };
}
