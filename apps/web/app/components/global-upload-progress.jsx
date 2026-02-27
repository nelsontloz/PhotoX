"use client";

import { useUpload } from "./upload-context";
import { formatBytes } from "../../lib/upload";
import { usePathname } from "next/navigation";

export default function GlobalUploadProgress() {
    const {
        fileProgressList,
        overallProgress,
        uploadSummary,
        uploadError,
        isUploading,
        activeCount,
        isMinimized,
        setIsMinimized,
        handleClearAll
    } = useUpload();

    const pathname = usePathname();

    if (pathname === "/upload") {
        return null;
    }

    if (fileProgressList.length === 0 && !overallProgress && !uploadError) {
        return null;
    }

    const hasFinished = !isUploading && (uploadSummary || fileProgressList.length > 0);

    return (
        <div className="fixed bottom-6 right-6 w-80 bg-slate-900 border border-border-dark rounded-xl shadow-2xl z-[60] flex flex-col overflow-hidden transition-all duration-300">
            <div
                className="flex items-center justify-between px-4 py-3 border-b border-border-dark bg-slate-900/50 cursor-pointer"
                onClick={() => setIsMinimized(!isMinimized)}
            >
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    {isUploading ? (
                        <span className="relative flex h-2 w-2">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                        </span>
                    ) : uploadError ? (
                        <span className="material-symbols-outlined text-red-500 text-sm">error</span>
                    ) : (
                        <span className="material-symbols-outlined text-primary text-sm">check_circle</span>
                    )}
                    {isUploading ? `Uploading ${activeCount} items` : hasFinished ? "Upload complete" : uploadError ? "Upload Error" : "Preparing..."}
                </h3>
                <div className="flex items-center gap-1">
                    <button
                        className="p-1 rounded-md hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsMinimized(!isMinimized);
                        }}
                    >
                        <span className="material-symbols-outlined text-[18px]">{isMinimized ? 'expand_less' : 'expand_more'}</span>
                    </button>
                    <button
                        className="p-1 rounded-md hover:bg-slate-700/50 text-slate-400 hover:text-white transition-colors"
                        onClick={(e) => {
                            e.stopPropagation();
                            handleClearAll();
                        }}
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {!isMinimized && (
                <div className="max-h-72 overflow-y-auto upload-queue-scroll p-2 bg-slate-900/40">
                    {uploadError && (
                        <div className="px-3 py-2 mb-2 rounded bg-red-900/20 border border-red-900/30 text-[11px] text-red-400">
                            {uploadError}
                        </div>
                    )}
                    {fileProgressList.map(progress => (
                        <MiniUploadItem
                            key={progress.fileIndex}
                            fileName={progress.fileName}
                            fileSize={progress.totalBytes}
                            percent={progress.percent}
                            status={progress.status}
                            error={progress.error}
                        />
                    ))}
                </div>
            )}

            {overallProgress && (
                <div className="px-4 py-2 border-t border-border-dark bg-slate-900/30 text-center">
                    <span className="text-[10px] font-medium text-slate-500">
                        {formatBytes(overallProgress.uploadedBytes)} of {formatBytes(overallProgress.totalBytes)} uploaded
                    </span>
                    <div className="mt-1 w-full h-0.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                            className={`h-full transition-all duration-300 ${uploadError ? 'bg-red-500' : hasFinished ? 'bg-green-500' : 'bg-primary'}`}
                            style={{ width: `${overallProgress.percent}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

function MiniUploadItem({ fileName, fileSize, percent = 0, status, error }) {
    const isCompleted = status === "success";
    const isUploading = status === "uploading";
    const isFailed = status === "failed";
    const isQueued = status === "queued";

    return (
        <div className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors">
            <div className={`size-8 rounded overflow-hidden shrink-0 flex items-center justify-center ${isFailed ? 'bg-red-900/20' : isCompleted ? 'bg-green-900/20' : 'bg-slate-800'} ${isQueued ? 'opacity-50' : ''}`}>
                <span className={`material-symbols-outlined text-sm ${isFailed ? 'text-red-500' : isCompleted ? 'text-green-500' : 'text-slate-500'}`}>
                    {isFailed ? 'broken_image' : isCompleted ? 'check_circle' : 'image'}
                </span>
            </div>
            <div className="flex-1 min-w-0">
                <div className="flex justify-between items-center mb-1">
                    <span className={`text-xs font-medium truncate ${isQueued || isFailed ? 'text-slate-500' : 'text-slate-300'}`}>
                        {fileName}
                    </span>
                    <span className={`text-[10px] font-medium ${isQueued || isFailed || isCompleted ? 'text-slate-500' : 'text-primary'}`}>
                        {isFailed ? "Failed" : isCompleted ? "Uploaded" : isQueued ? "Queued" : `${percent}%`}
                    </span>
                </div>
                <div className="w-full h-1 bg-slate-700 rounded-full overflow-hidden">
                    <div
                        className={`h-full transition-all duration-300 ${isFailed ? 'bg-red-500' : isCompleted ? 'bg-green-500' : 'bg-primary'}`}
                        style={{ width: `${isCompleted ? 100 : percent}%` }}
                    />
                </div>
            </div>
        </div>
    );
}
