"use client";

export function LightboxInfoPanel({ showInfo, metadata, detail, location, onClose }) {
    const imageExif = metadata.image || {};

    return (
        <aside
            className={`absolute top-0 right-0 w-80 h-full bg-card-dark/95 backdrop-blur-md border-l border-border-dark flex flex-col shrink-0 z-40 transition-transform duration-300 ease-in-out shadow-2xl ${showInfo ? "translate-x-0" : "translate-x-full"}`}
            aria-hidden={!showInfo}
        >
            <div className="h-16 flex items-center px-6 border-b border-border-dark shrink-0">
                <h2 className="text-white font-semibold text-lg">Details</h2>
                <button
                    type="button"
                    onClick={onClose}
                    className="ml-auto p-1.5 text-slate-400 hover:text-white transition-colors"
                    aria-label="Close details panel"
                >
                    <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
            </div>

            <div className="flex-1 overflow-y-auto info-panel-scroll p-6 space-y-8 no-scrollbar">
                <section>
                    <div className="flex items-center gap-2 text-slate-400 mb-2">
                        <span className="material-symbols-outlined text-[18px]">notes</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider">Description</h4>
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed font-normal">
                        {metadata.raw?.description || detail?.description || "No description provided for this media."}
                    </p>
                </section>

                <section>
                    <div className="flex items-center gap-2 text-slate-400 mb-4">
                        <span className="material-symbols-outlined text-[18px]">camera</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider">Camera Info</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-y-4 gap-x-2">
                        <InfoCell label="Camera" value={imageExif.make || imageExif.model || "Unknown"} />
                        <InfoCell label="Lens" value={imageExif.lensModel || "Unknown Lens"} />
                        <InfoCell label="Aperture" value={imageExif.fNumber ? `f/${imageExif.fNumber}` : "Unknown"} />
                        <InfoCell label="Shutter" value={imageExif.exposureTime ? `${imageExif.exposureTime}s` : "Unknown"} />
                        <InfoCell label="ISO" value={imageExif.iso || "Unknown"} />
                        <InfoCell label="Focal Length" value={imageExif.focalLength ? `${imageExif.focalLength}mm` : "Unknown"} />
                    </div>
                </section>

                <section>
                    <div className="flex items-center gap-2 text-slate-400 mb-4">
                        <span className="material-symbols-outlined text-[18px]">location_on</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider">Location</h4>
                    </div>
                    <div className="rounded-lg border border-border-dark bg-slate-900/40 p-4">
                        <p className="mt-1 text-xs text-slate-300 font-medium">{location.address || "Unknown Location"}</p>
                        <p className="text-[10px] text-slate-500 mt-1">
                            {typeof location.latitude === "number" && typeof location.longitude === "number"
                                ? `${location.latitude.toFixed(4)}°, ${location.longitude.toFixed(4)}°`
                                : "Coordinates unavailable"}
                        </p>
                    </div>
                </section>

                <section>
                    <div className="flex items-center gap-2 text-slate-400 mb-4">
                        <span className="material-symbols-outlined text-[18px]">label</span>
                        <h4 className="text-xs font-bold uppercase tracking-wider">Keywords</h4>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {(metadata.raw?.keywords || []).length > 0 ? (
                            metadata.raw.keywords.map((kw, i) => (
                                <span key={i} className="text-[10px] bg-slate-800/50 text-slate-400 px-2 py-0.5 rounded">
                                    {kw}
                                </span>
                            ))
                        ) : (
                            <span className="text-xs text-slate-500">No keywords available</span>
                        )}
                    </div>
                </section>
            </div>
        </aside>
    );
}

function InfoCell({ label, value }) {
    return (
        <div>
            <p className="text-[10px] text-slate-500 uppercase tracking-tight">{label}</p>
            <p className="text-xs text-slate-200 font-medium">{value}</p>
        </div>
    );
}
