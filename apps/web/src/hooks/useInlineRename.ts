import { useRef, useState } from 'react'

/**
 * Inline click-to-rename state machine shared by the album/person headers.
 *
 * `currentName` is the committed name from parent state (seed + revert target).
 * `commit` performs the mutation and updates parent state; on throw the value reverts.
 * `allowEmpty` lets `commit('')` through (person names are clearable); otherwise
 * empty input just closes without a call.
 */
export function useInlineRename(
  currentName: string,
  commit: (name: string) => Promise<void>,
  opts?: { allowEmpty?: boolean },
): {
  editing: boolean
  nameValue: string
  setNameValue: (v: string) => void
  start: () => void
  save: () => Promise<void>
  cancel: () => void
} {
  const [editing, setEditing] = useState(false)
  const [nameValue, setNameValue] = useState(currentName)
  // ponytail: re-entry guard only (Enter unmounts the input mid-save and blur can re-fire save)
  const busy = useRef(false)

  const start = () => {
    setNameValue(currentName)
    setEditing(true)
  }

  const cancel = () => {
    setNameValue(currentName)
    setEditing(false)
  }

  const save = async () => {
    if (busy.current) return
    const trimmed = nameValue.trim()
    if (trimmed === currentName || (trimmed === '' && !opts?.allowEmpty)) {
      cancel()
      return
    }
    busy.current = true
    try {
      await commit(trimmed)
    } catch {
      setNameValue(currentName)
    } finally {
      busy.current = false
      setEditing(false)
    }
  }

  return { editing, nameValue, setNameValue, start, save, cancel }
}
