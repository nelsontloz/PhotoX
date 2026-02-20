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
        <div className="fixed bottom-6 right-6 z-50 w-full max-w-sm flex flex-col gap-2 transition-all duration-300 transform translate-y-0">
            <div className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark shadow-xl overflow-hidden flex flex-col">
                <div
                    className="flex items-center justify-between px-4 py-3 bg-slate-50 dark:bg-slate-800/50 cursor-pointer"
                    onClick={() => setIsMinimized(!isMinimized)}
                >
                    <div className="flex items-center gap-3">
                        {isUploading ? (
                            <span className="material-symbols-outlined text-primary animate-spin">progress_activity</span>
                        ) : uploadError ? (
                            <span className="material-symbols-outlined text-red-500">error</span>
                        ) : (
                            <span className="material-symbols-outlined text-green-500">check_circle</span>
                        )}
                        <div>
                            <p className="text-sm font-bold text-slate-900 dark:text-white">
                                {isUploading ? `Uploading ${activeCount} files` : hasFinished ? "Upload complete" : uploadError ? "Upload Error" : "Preparing upload..."}
                            </p>
                            {overallProgress && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                    {overallProgress.percent}% • {overallProgress.processedFiles}/{overallProgress.totalFiles} files
                                </p>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleClearAll();
                            }}
                            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                            title="Close"
                        >
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                        <span className="material-symbols-outlined text-slate-400 transition-transform" style={{ transform: isMinimized ? 'rotate(180deg)' : 'rotate(0deg)' }}>
                            expand_more
                        </span>
                    </div>
                </div>

                {overallProgress && (
                    <div className="h-1 w-full bg-slate-100 dark:bg-slate-800">
                        <div
                            className={`h-full transition-all duration-300 ${uploadError ? 'bg-red-500' : 'bg-primary'}`}
                            style={{ width: `${overallProgress.percent}%` }}
                        />
                    </div>
                )}

                {!isMinimized && (
                    <div className="max-h-64 overflow-y-auto p-2 flex flex-col gap-2">
                        {uploadError && (
                            <div className="rounded bg-red-50 dark:bg-red-900/10 p-2 text-xs text-red-600 dark:text-red-400">
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
            </div>
        </div>
    );
}

function MiniUploadItem({ fileName, fileSize, percent = 0, status, error }) {
    const isCompleted = status === "success";
    const isUploading = status === "uploading";
    const isFailed = status === "failed";

    return (
        <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50">
            <div className={`flex items-center justify-center size-8 rounded ${isFailed ? 'bg-red-100 dark:bg-red-900/30 text-red-500' : isCompleted ? 'bg-green-100 dark:bg-green-900/30 text-green-500' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}`}>
                {isFailed ? (
                    <span className="material-symbols-outlined text-[16px]">broken_image</span>
                ) : isCompleted ? (
                    <span className="material-symbols-outlined text-[16px]">check_circle</span>
                ) : isUploading ? (
                    <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                ) : (
                    <span className="material-symbols-outlined text-[16px]">image</span>
                )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-xs font-medium text-slate-900 dark:text-white">{fileName}</p>
                <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <span className={isFailed ? 'text-red-500' : ''}>{isFailed ? (error || 'Failed') : formatBytes(fileSize)}</span>
                    {!isCompleted && !isFailed && <span>{percent}%</span>}
                </div>
            </div>
        </div>
    );
}
