# PhotoX

Vocabulary for a personal photo/video library: assets on one machine, backed up per user to an object store, restorable into the live library. Domain terms only — design decisions live in `docs/adr/`.

## Language

**Asset**:
One photo or video in a user's library, identified by the checksum of its bytes.
_Avoid_: Photo, media item, file

**Original**:
The exact bytes a client uploaded for an asset. Never modified.
_Avoid_: Source file, raw

**Derivative**:
Bytes produced from an original (thumbnail, transcode, face crop). Discardable: it can always be regenerated.
_Avoid_: Generated file, output

**Backup**:
The copy of a user's library kept outside the live database and disk: the profile, album and share membership, and the original bytes of every asset.
_Avoid_: Archive, dump

**Snapshot**:
What a backup contains at one moment: a storage location plus the manifest that indexes it.
_Avoid_: Backup version, archive copy

**Manifest**:
A snapshot's index: profile data, album and share links, and one entry per file with its checksum. Written last, so a manifest's presence means the snapshot is complete.
_Avoid_: Index file, catalogue

**Backup prefix**:
The storage location holding one snapshot, derived from the account's email and id.
_Avoid_: Folder, backup path

**Backup run**:
One attempt to write a snapshot (a backup) or to apply one (a restore). A run ends completed, partial, failed, or paused.
_Avoid_: Backup job, task

**Transfer item**:
One original's unit of work within a run.
_Avoid_: File job, chunk

**Incremental backup**:
A run that reuses unchanged files from the previous snapshot instead of rewriting them.
_Avoid_: Differential backup, delta

**Restore**:
Applying a snapshot's rows and bytes onto the live library.
_Avoid_: Import, recovery

**Merge (adoption)**:
Folding a deleted account's snapshot into a live account that now holds the same email address.
_Avoid_: Attach, transfer ownership

**Orphan snapshot**:
A snapshot in storage whose account no longer exists.
_Avoid_: Dangling backup

**Paused**:
A run stopped because the machine cannot accept more bytes (disk full or unwritable). Completed work is kept; the run resumes by being started again.
_Avoid_: Stopped, aborted, suspended
