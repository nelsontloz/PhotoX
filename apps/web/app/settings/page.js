"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    fetchWorkerVideoEncodingProfile,
    formatApiError,
    saveWorkerVideoEncodingProfile
} from "../../lib/api";
import { useRequireSession } from "../shared/hooks/useRequireSession";
import { PageLayout } from "../components/PageLayout";
import { SessionLoadingScreen } from "../components/SessionLoadingScreen";
import { ErrorBanner } from "../components/ErrorBanner";
import { EmptyState } from "../components/EmptyState";
import { PageHeader } from "../components/PageHeader";
import {
    AUDIO_CODEC_OPTIONS,
    CODEC_OPTIONS,
    createEmptyVideoEncodingForm,
    FORMAT_OPTIONS,
    getAudioCodecForFormat,
    getCodecForFormat,
    isVideoEncodingSectionVisible,
    PRESET_OPTIONS,
    profileToVideoEncodingForm,
    toVideoEncodingProfilePayload,
    validateVideoEncodingForm
} from "./utils";

const RESOLUTION_OPTIONS = ["640x360", "854x480", "1280x720", "1920x1080"];

export default function SettingsPage() {
    const queryClient = useQueryClient();
    const { meQuery, user, isAuthorized } = useRequireSession({
        redirectPath: "/settings"
    });

    const [form, setForm] = useState(createEmptyVideoEncodingForm);
    const [formError, setFormError] = useState("");
    const [successMessage, setSuccessMessage] = useState("");

    const profileQuery = useQuery({
        queryKey: ["worker-video-encoding-profile"],
        queryFn: () => fetchWorkerVideoEncodingProfile(),
        enabled: Boolean(isAuthorized && isVideoEncodingSectionVisible(user)),
        retry: false
    });

    useEffect(() => {
        if (profileQuery.data?.profile) {
            setForm(profileToVideoEncodingForm(profileQuery.data.profile));
            setFormError("");
        }
    }, [profileQuery.data]);

    const saveMutation = useMutation({
        mutationFn: (profilePayload) => saveWorkerVideoEncodingProfile(profilePayload),
        onSuccess: (payload) => {
            setForm(profileToVideoEncodingForm(payload.profile));
            setFormError("");
            setSuccessMessage("Default video encoding profile saved");
            queryClient.setQueryData(["worker-video-encoding-profile"], payload);
        },
        onError: (error) => {
            setSuccessMessage("");
            setFormError(formatApiError(error));
        }
    });

    useEffect(() => {
        if (!successMessage) {
            return undefined;
        }
        const timeoutId = setTimeout(() => setSuccessMessage(""), 2500);
        return () => clearTimeout(timeoutId);
    }, [successMessage]);

    function updateField(field, value) {
        setForm((current) => ({ ...current, [field]: value }));
        setSuccessMessage("");
    }

    function handleOutputFormatChange(nextFormat) {
        setForm((current) => ({
            ...current,
            outputFormat: nextFormat,
            codec: getCodecForFormat(nextFormat),
            audioCodec: getAudioCodecForFormat(nextFormat)
        }));
        setSuccessMessage("");
    }

    function handleResetToSaved() {
        if (!profileQuery.data?.profile) {
            return;
        }
        setForm(profileToVideoEncodingForm(profileQuery.data.profile));
        setFormError("");
        setSuccessMessage("");
    }

    function onSubmit(event) {
        event.preventDefault();
        const issues = validateVideoEncodingForm(form);
        if (issues.length > 0) {
            setSuccessMessage("");
            setFormError(issues[0]);
            return;
        }

        setFormError("");
        saveMutation.mutate(toVideoEncodingProfilePayload(form));
    }

    if (meQuery.isPending) {
        return <SessionLoadingScreen label="Validating session..." />;
    }

    if (!isAuthorized) {
        return null;
    }

    const isAdmin = Boolean(user?.isAdmin);

    return (
        <PageLayout activeLabel="Settings" isAdmin={isAdmin} mainClassName="px-4 sm:px-8 pb-20 pt-8">
            <div className="mx-auto flex w-full max-w-[920px] flex-col gap-6">
                <PageHeader
                    title="Settings"
                    subtitle="Platform-level defaults and preferences"
                />

                {!isAdmin ? (
                    <EmptyState
                        icon="lock"
                        title="Admin settings only"
                        description="Only administrators can view or modify the default video encoding profile."
                        cta={{ label: "Go to Timeline", href: "/timeline", icon: "photo_library" }}
                    />
                ) : (
                    <section className="rounded-xl border border-slate-200 dark:border-border-dark bg-white dark:bg-card-dark p-5 sm:p-6">
                        <div className="mb-5 border-b border-slate-200 dark:border-border-dark pb-4">
                            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Default Video Encoding Profile</h2>
                            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                                New video processing jobs use this profile automatically unless a per-job override is provided.
                            </p>
                        </div>

                        <ErrorBanner
                            message={formError || (profileQuery.isError ? formatApiError(profileQuery.error) : "")}
                            className="mb-4"
                        />

                        {successMessage && (
                            <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-900/40 dark:bg-emerald-900/10 dark:text-emerald-300">
                                {successMessage}
                            </div>
                        )}

                        {profileQuery.isLoading ? (
                            <p className="text-sm text-slate-500 dark:text-slate-400">Loading encoding profile...</p>
                        ) : (
                            <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Output format</span>
                                    <select
                                        value={form.outputFormat}
                                        onChange={(event) => handleOutputFormatChange(event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    >
                                        {FORMAT_OPTIONS.map((format) => (
                                            <option key={format} value={format}>{format}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Preset / quality</span>
                                    <select
                                        value={form.preset}
                                        onChange={(event) => updateField("preset", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    >
                                        {PRESET_OPTIONS.map((preset) => (
                                            <option key={preset} value={preset}>{preset}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Video codec</span>
                                    <select
                                        value={form.codec}
                                        onChange={(event) => updateField("codec", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    >
                                        {CODEC_OPTIONS.filter((item) => item.format === form.outputFormat).map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Audio codec</span>
                                    <select
                                        value={form.audioCodec}
                                        onChange={(event) => updateField("audioCodec", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    >
                                        {AUDIO_CODEC_OPTIONS.filter((item) => item.format === form.outputFormat).map((option) => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Resolution</span>
                                    <select
                                        value={form.resolution}
                                        onChange={(event) => updateField("resolution", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    >
                                        {RESOLUTION_OPTIONS.map((value) => (
                                            <option key={value} value={value}>{value}</option>
                                        ))}
                                    </select>
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Frame rate (fps)</span>
                                    <input
                                        type="number"
                                        min={1}
                                        max={120}
                                        value={form.frameRate}
                                        onChange={(event) => updateField("frameRate", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    />
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Video bitrate (kbps)</span>
                                    <input
                                        type="number"
                                        min={64}
                                        max={100000}
                                        value={form.bitrateKbps}
                                        onChange={(event) => updateField("bitrateKbps", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    />
                                </label>

                                <label className="flex flex-col gap-2 text-sm">
                                    <span className="font-medium text-slate-700 dark:text-slate-300">Audio bitrate (kbps)</span>
                                    <input
                                        type="number"
                                        min={32}
                                        max={512}
                                        value={form.audioBitrateKbps}
                                        onChange={(event) => updateField("audioBitrateKbps", event.target.value)}
                                        className="h-11 rounded-lg border border-slate-300 bg-white px-3 text-slate-900 focus:border-primary focus:outline-none dark:border-slate-700 dark:bg-background-dark dark:text-white"
                                    />
                                </label>

                                <div className="md:col-span-2 mt-2 flex flex-wrap items-center justify-end gap-2">
                                    <button
                                        type="button"
                                        onClick={handleResetToSaved}
                                        className="inline-flex h-10 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                                        disabled={saveMutation.isPending}
                                    >
                                        Reset
                                    </button>
                                    <button
                                        type="submit"
                                        className="inline-flex h-10 items-center rounded-lg bg-primary px-5 text-sm font-bold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
                                        disabled={saveMutation.isPending}
                                    >
                                        {saveMutation.isPending ? "Saving..." : "Save profile"}
                                    </button>
                                </div>
                            </form>
                        )}
                    </section>
                )}
            </div>
        </PageLayout>
    );
}
