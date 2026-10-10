import { formInputClass } from './Dialog'

const NEW_ALBUM_NAME_MAX = 255

/**
 * Name + description fields shared by the listing's New Album dialog and the album picker's
 * create step. Call sites keep their own submit/error state; only the field block is shared.
 */
export function NewAlbumFields({
  name,
  onNameChange,
  description,
  onDescriptionChange,
}: {
  name: string
  onNameChange: (value: string) => void
  description: string
  onDescriptionChange: (value: string) => void
}) {
  return (
    <>
      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5">
        Name
      </label>
      <input
        autoFocus
        type="text"
        value={name}
        maxLength={NEW_ALBUM_NAME_MAX}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="e.g. Summer 2025"
        className={formInputClass}
      />
      <div className="mt-1 flex justify-between text-[11px] text-slate-500">
        <span>Required</span>
        <span className="tabular-nums">
          {name.trim().length}/{NEW_ALBUM_NAME_MAX}
        </span>
      </div>

      <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-1.5 mt-4">
        Description <span className="text-slate-500 normal-case font-normal">(optional)</span>
      </label>
      <textarea
        value={description}
        rows={3}
        onChange={(e) => onDescriptionChange(e.target.value)}
        placeholder="What's this album about?"
        className={`${formInputClass} resize-none`}
      />
    </>
  )
}
