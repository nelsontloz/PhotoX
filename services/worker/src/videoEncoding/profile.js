const DEFAULT_VIDEO_ENCODING_PROFILE = Object.freeze({
    codec: "libvpx-vp9",
    resolution: "1280x720",
    bitrateKbps: 1800,
    frameRate: 30,
    audioCodec: "libopus",
    audioBitrateKbps: 96,
    preset: "balanced",
    outputFormat: "webm"
});

const PROFILE_KEY = "default_video_playback";

function parsePositiveInteger(value, fieldName, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        throw new Error(`${fieldName} must be an integer between ${min} and ${max}`);
    }
    return parsed;
}

function parseResolution(value) {
    const text = String(value || "").trim().toLowerCase();
    const match = text.match(/^(\d{2,5})x(\d{2,5})$/);
    if (!match) {
        throw new Error("resolution must use WIDTHxHEIGHT format, for example 1280x720");
    }

    const width = parsePositiveInteger(match[1], "resolution width", { min: 16, max: 8192 });
    const height = parsePositiveInteger(match[2], "resolution height", { min: 16, max: 8192 });
    return {
        value: `${width}x${height}`,
        width,
        height
    };
}

function normalizeVideoEncodingProfile(input = {}, { defaults = DEFAULT_VIDEO_ENCODING_PROFILE } = {}) {
    const codec = String(input.codec ?? defaults.codec).trim();
    const resolution = parseResolution(input.resolution ?? defaults.resolution).value;
    const bitrateKbps = parsePositiveInteger(input.bitrateKbps ?? defaults.bitrateKbps, "bitrateKbps", {
        min: 64,
        max: 100000
    });
    const frameRate = parsePositiveInteger(input.frameRate ?? defaults.frameRate, "frameRate", {
        min: 1,
        max: 120
    });
    const audioCodec = String(input.audioCodec ?? defaults.audioCodec).trim();
    const audioBitrateKbps = parsePositiveInteger(
        input.audioBitrateKbps ?? defaults.audioBitrateKbps,
        "audioBitrateKbps",
        {
            min: 32,
            max: 512
        }
    );
    const preset = String(input.preset ?? defaults.preset).trim().toLowerCase();
    const outputFormat = String(input.outputFormat ?? defaults.outputFormat).trim().toLowerCase();

    const allowed = {
        webm: { codec: new Set(["libvpx-vp9"]), audioCodec: new Set(["libopus"]) },
        mp4: { codec: new Set(["libx264"]), audioCodec: new Set(["aac"]) }
    };

    if (!allowed[outputFormat]) {
        throw new Error("outputFormat must be one of: webm, mp4");
    }

    if (!allowed[outputFormat].codec.has(codec)) {
        throw new Error(`codec '${codec}' is not valid for outputFormat '${outputFormat}'`);
    }

    if (!allowed[outputFormat].audioCodec.has(audioCodec)) {
        throw new Error(`audioCodec '${audioCodec}' is not valid for outputFormat '${outputFormat}'`);
    }

    if (!["fast", "balanced", "quality"].includes(preset)) {
        throw new Error("preset must be one of: fast, balanced, quality");
    }

    return {
        codec,
        resolution,
        bitrateKbps,
        frameRate,
        audioCodec,
        audioBitrateKbps,
        preset,
        outputFormat
    };
}

function getResolutionScaleFilter(resolution) {
    const { width, height } = parseResolution(resolution);
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease`;
}

function buildPlaybackFfmpegArgs({ sourceAbsolutePath, derivativeAbsolutePath, profile }) {
    const normalized = normalizeVideoEncodingProfile(profile);

    const args = [
        "-y",
        "-v",
        "error",
        "-i",
        sourceAbsolutePath,
        "-map",
        "0:v:0",
        "-map",
        "0:a?",
        "-vf",
        getResolutionScaleFilter(normalized.resolution),
        "-r",
        String(normalized.frameRate),
        "-c:v",
        normalized.codec,
        "-b:v",
        `${normalized.bitrateKbps}k`,
        "-c:a",
        normalized.audioCodec,
        "-b:a",
        `${normalized.audioBitrateKbps}k`
    ];

    if (normalized.outputFormat === "webm") {
        const cpuUsedByPreset = {
            fast: "4",
            balanced: "2",
            quality: "1"
        };
        args.push("-row-mt", "1", "-threads", "0", "-cpu-used", cpuUsedByPreset[normalized.preset]);
    } else {
        const x264PresetByPreset = {
            fast: "veryfast",
            balanced: "medium",
            quality: "slow"
        };
        args.push("-preset", x264PresetByPreset[normalized.preset], "-movflags", "+faststart");
    }

    args.push(derivativeAbsolutePath);
    return {
        args,
        normalizedProfile: normalized
    };
}

function resolvePlaybackProfile({ savedProfile, overrideProfile }) {
    if (overrideProfile && typeof overrideProfile === "object") {
        return normalizeVideoEncodingProfile(overrideProfile, {
            defaults: normalizeVideoEncodingProfile(savedProfile || DEFAULT_VIDEO_ENCODING_PROFILE)
        });
    }

    if (savedProfile && typeof savedProfile === "object") {
        return normalizeVideoEncodingProfile(savedProfile);
    }

    return normalizeVideoEncodingProfile(DEFAULT_VIDEO_ENCODING_PROFILE);
}

module.exports = {
    DEFAULT_VIDEO_ENCODING_PROFILE,
    PROFILE_KEY,
    buildPlaybackFfmpegArgs,
    normalizeVideoEncodingProfile,
    resolvePlaybackProfile
};

