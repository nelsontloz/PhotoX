"use client";

import { useMutation } from "@tanstack/react-query";
import { createContext, useContext, useState, useMemo } from "react";
import { formatApiError } from "../../lib/api";
import { uploadMediaFilesInChunks } from "../../lib/upload";

const UploadContext = createContext(null);

export function UploadProvider({ children }) {
    const [selectedFiles, setSelectedFiles] = useState([]);
    const [fileProgressByIndex, setFileProgressByIndex] = useState({});
    const [overallProgress, setOverallProgress] = useState(null);
    const [uploadSummary, setUploadSummary] = useState(null);
    const [uploadError, setUploadError] = useState("");
    const [isMinimized, setIsMinimized] = useState(false);

    const uploadMutation = useMutation({
        mutationFn: (files) =>
            uploadMediaFilesInChunks({
                files,
                maxConcurrent: 4,
                onFileProgress: (progress) => {
                    setFileProgressByIndex((previous) => ({
                        ...previous,
                        [progress.fileIndex]: {
                            ...(previous[progress.fileIndex] || {}),
                            ...progress
                        }
                    }));
                },
                onOverallProgress: (progress) => {
                    setOverallProgress(progress);
                }
            }),
        onMutate: (files) => {
            setUploadError("");
            setUploadSummary(null);

            const initialProgressByIndex = {};
            for (const [index, file] of files.entries()) {
                initialProgressByIndex[index] = {
                    fileIndex: index,
                    fileName: file.name,
                    uploadedBytes: 0,
                    totalBytes: file.size,
                    percent: 0,
                    partNumber: 0,
                    totalParts: 0,
                    status: "queued"
                };
            }

            setFileProgressByIndex(initialProgressByIndex);
            setOverallProgress({
                processedFiles: 0,
                totalFiles: files.length,
                successfulCount: 0,
                failedCount: 0,
                uploadedBytes: 0,
                totalBytes: files.reduce((sum, file) => sum + file.size, 0),
                percent: 0
            });
            setIsMinimized(false);
        },
        onSuccess: (summary) => {
            setUploadSummary(summary);
        },
        onError: (error) => {
            setUploadError(formatApiError(error));
        }
    });

    const fileProgressList = useMemo(
        () => Object.values(fileProgressByIndex).sort((a, b) => {
            const statusWeight = {
                "uploading": 1,
                "queued": 2,
                "failed": 3,
                "success": 4
            };

            const weightA = statusWeight[a.status] || 5;
            const weightB = statusWeight[b.status] || 5;

            if (weightA !== weightB) {
                return weightA - weightB;
            }
            return a.fileIndex - b.fileIndex;
        }),
        [fileProgressByIndex]
    );

    const activeCount = useMemo(
        () => fileProgressList.filter((item) => item.status === "uploading" || item.status === "queued").length,
        [fileProgressList]
    );

    function uploadFiles(validFiles) {
        setOverallProgress(null);
        setUploadSummary(null);
        setFileProgressByIndex({});
        setSelectedFiles(validFiles);

        uploadMutation.mutate(validFiles);
    }

    function handleClearAll() {
        setFileProgressByIndex({});
        setSelectedFiles([]);
        setOverallProgress(null);
        setUploadSummary(null);
        setUploadError("");
    }

    const value = {
        selectedFiles,
        fileProgressByIndex,
        fileProgressList,
        overallProgress,
        uploadSummary,
        uploadError,
        activeCount,
        isUploading: uploadMutation.isPending,
        isMinimized,
        setIsMinimized,
        uploadFiles,
        handleClearAll
    };

    return <UploadContext.Provider value={value}>{children}</UploadContext.Provider>;
}

export function useUpload() {
    const context = useContext(UploadContext);
    if (!context) {
        throw new Error("useUpload must be used within an UploadProvider");
    }
    return context;
}
