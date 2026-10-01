# apps/core/src/settings/

## Responsibility

Persisted key/value application settings backing the admin face-detector switch and the face-reprocess last-run record: reads the effective detector (setting → env fallback), reports SCRFD model availability and per-detector face counts, and upserts changes.

## Design

- `SettingsModule` is non-global (not imported by `AppModule`): `TypeOrmModule.forFeature([AppSetting, Face])`, provides and exports `SettingsService`. Imported explicitly by `UserFilesModule` (stamps the detector on upload) and `AdminModule` (admin API + bulk reprocess/recluster).
- Keys: `FACE_DETECTOR_SETTING_KEY = 'face.detector'`, `FACE_REPROCESS_LAST_RUN_KEY = 'face.reprocess.lastRun'`.
- `getFaceDetector()` reads the `face.detector` row and validates it against `FACE_DETECTOR_KINDS`; missing/invalid → `envDefaultDetector()` (`envFaceDetectorKind()`: `FACE_DETECTOR === 'scrfd'` else `human`). `setFaceDetector(kind)` upserts on `key`.
- `getSettings()` → `FaceDetectionSettings`: `{ detector, envDefault, models: { scrfd }, facesByDetector }`. `models.scrfd` checks `access(resolveFaceDetectorModelPath())` (`FACE_DETECTOR_MODEL_PATH` or `STORAGE_DIR/models/det_10g.onnx`); `facesByDetector` counts `Face` rows by provenance (`human`/`scrfd`/`unset` via `IsNull()`), all in parallel.
- Last-run: `getFaceReprocessLastRun()` parses and validates the stored JSON (`FaceReprocessLastRun { startedAt, total, enqueued, detector }`, malformed → `null`); `setFaceReprocessLastRun(run)` upserts. Written by `AdminFacesService.reprocess()`.
- Admin API (controller lives in `admin/`): `GET`/`PUT api/v1/admin/face-detection`; `PUT` validates `detector` with `@IsIn(FACE_DETECTOR_KINDS)` and returns the refreshed settings. Admin role is enforced centrally by the global `JwtAuthGuard` on `api/v1/admin/*`.

## Flow

Photo upload (`UserFilesService.upload`) → `getFaceDetector()` best-effort (catch → env default) → `detector` stamped into the `process-faces` job payload. Admin switch → `PUT` upsert → later uploads/reprocess runs pick it up; in-flight jobs keep the detector they were enqueued with. Face reprocess resolves the setting once per run and stores its last-run summary.

## Integration

- Entities `AppSetting` and `Face` from `src/database/entities`; no controller in this folder.
- `envFaceDetectorKind()` / `resolveFaceDetectorModelPath()` / `FACE_DETECTOR_MODEL_FILE` from `@photox/shared-config` (direct `process.env` reads outside the zod schema).
- Wire types `FaceDetectorKind`, `FaceDetectionSettings` from `@photox/shared-types`; the web admin Face detection section consumes the API.
