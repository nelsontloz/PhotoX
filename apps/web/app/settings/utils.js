export const CODEC_OPTIONS = [
    { value: "libvpx-vp9", label: "VP9 (libvpx-vp9)", format: "webm" },
    { value: "libx264", label: "H.264 (libx264)", format: "mp4" }
];

export const AUDIO_CODEC_OPTIONS = [
    { value: "libopus", label: "Opus (libopus)", format: "webm" },
    { value: "aac", label: "AAC (aac)", format: "mp4" }
];

export const PRESET_OPTIONS = ["fast", "balanced", "quality"];
export const FORMAT_OPTIONS = ["webm", "mp4"];

export function createEmptyVideoEncodingForm() {
    return {
        codec: "libvpx-vp9",
        resolution: "1280x720",
        bitrateKbps: "1800",
        frameRate: "30",
        audioCodec: "libopus",
        audioBitrateKbps: "96",
        preset: "balanced",
        outputFormat: "webm"
    };
}

export function profileToVideoEncodingForm(profile = {}) {
    return {
        codec: String(profile.codec || ""),
        resolution: String(profile.resolution || ""),
        bitrateKbps: String(profile.bitrateKbps ?? ""),
        frameRate: String(profile.frameRate ?? ""),
        audioCodec: String(profile.audioCodec || ""),
        audioBitrateKbps: String(profile.audioBitrateKbps ?? ""),
        preset: String(profile.preset || ""),
        outputFormat: String(profile.outputFormat || "")
    };
}

export function getCodecForFormat(format) {
    const hit = CODEC_OPTIONS.find((item) => item.format === format);
    return hit?.value || "";
}

export function getAudioCodecForFormat(format) {
    const hit = AUDIO_CODEC_OPTIONS.find((item) => item.format === format);
    return hit?.value || "";
}

export function validateVideoEncodingForm(form) {
    const issues = [];

    if (!form.codec) issues.push("codec is required");
    if (!/^\d{2,5}x\d{2,5}$/i.test(form.resolution.trim())) issues.push("resolution must match WIDTHxHEIGHT, e.g. 1280x720");

    const bitrateKbps = Number.parseInt(form.bitrateKbps, 10);
    if (!Number.isInteger(bitrateKbps) || bitrateKbps < 64 || bitrateKbps > 100000) {
        issues.push("bitrateKbps must be an integer between 64 and 100000");
    }

    const frameRate = Number.parseInt(form.frameRate, 10);
    if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 120) {
        issues.push("frameRate must be an integer between 1 and 120");
    }

    if (!form.audioCodec) issues.push("audioCodec is required");

    const audioBitrateKbps = Number.parseInt(form.audioBitrateKbps, 10);
    if (!Number.isInteger(audioBitrateKbps) || audioBitrateKbps < 32 || audioBitrateKbps > 512) {
        issues.push("audioBitrateKbps must be an integer between 32 and 512");
    }

    if (!PRESET_OPTIONS.includes(form.preset)) issues.push("preset must be one of: fast, balanced, quality");
    if (!FORMAT_OPTIONS.includes(form.outputFormat)) issues.push("outputFormat must be one of: webm, mp4");

    if (form.outputFormat === "webm" && form.codec !== "libvpx-vp9") {
        issues.push("codec must be libvpx-vp9 when outputFormat is webm");
    }
    if (form.outputFormat === "webm" && form.audioCodec !== "libopus") {
        issues.push("audioCodec must be libopus when outputFormat is webm");
    }
    if (form.outputFormat === "mp4" && form.codec !== "libx264") {
        issues.push("codec must be libx264 when outputFormat is mp4");
    }
    if (form.outputFormat === "mp4" && form.audioCodec !== "aac") {
        issues.push("audioCodec must be aac when outputFormat is mp4");
    }

    return issues;
}

export function toVideoEncodingProfilePayload(form) {
    return {
        codec: form.codec.trim(),
        resolution: form.resolution.trim().toLowerCase(),
        bitrateKbps: Number.parseInt(form.bitrateKbps, 10),
        frameRate: Number.parseInt(form.frameRate, 10),
        audioCodec: form.audioCodec.trim(),
        audioBitrateKbps: Number.parseInt(form.audioBitrateKbps, 10),
        preset: form.preset,
        outputFormat: form.outputFormat
    };
}

export function isVideoEncodingSectionVisible(user) {
    return Boolean(user?.isAdmin);
}
