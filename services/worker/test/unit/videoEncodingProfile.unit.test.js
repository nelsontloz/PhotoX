const {
    DEFAULT_VIDEO_ENCODING_PROFILE,
    buildPlaybackFfmpegArgs,
    normalizeVideoEncodingProfile,
    resolvePlaybackProfile
} = require("../../src/videoEncoding/profile");

describe("video encoding profile", () => {
    it("normalizes a valid webm profile", () => {
        const normalized = normalizeVideoEncodingProfile({
            codec: "libvpx-vp9",
            resolution: "1920x1080",
            bitrateKbps: 2600,
            frameRate: 24,
            audioCodec: "libopus",
            audioBitrateKbps: 128,
            preset: "quality",
            outputFormat: "webm"
        });

        expect(normalized).toEqual({
            codec: "libvpx-vp9",
            resolution: "1920x1080",
            bitrateKbps: 2600,
            frameRate: 24,
            audioCodec: "libopus",
            audioBitrateKbps: 128,
            preset: "quality",
            outputFormat: "webm"
        });
    });

    it("rejects incompatible codec/output format combinations", () => {
        expect(() =>
            normalizeVideoEncodingProfile({
                codec: "libx264",
                resolution: "1280x720",
                bitrateKbps: 1800,
                frameRate: 30,
                audioCodec: "aac",
                audioBitrateKbps: 96,
                preset: "balanced",
                outputFormat: "webm"
            })
        ).toThrow("codec 'libx264' is not valid for outputFormat 'webm'");
    });

    it("builds ffmpeg args from profile", () => {
        const { args, normalizedProfile } = buildPlaybackFfmpegArgs({
            sourceAbsolutePath: "/tmp/in.mp4",
            derivativeAbsolutePath: "/tmp/out.webm",
            profile: {
                codec: "libvpx-vp9",
                resolution: "1280x720",
                bitrateKbps: 1800,
                frameRate: 30,
                audioCodec: "libopus",
                audioBitrateKbps: 96,
                preset: "balanced",
                outputFormat: "webm"
            }
        });

        expect(normalizedProfile.outputFormat).toBe("webm");
        expect(args).toContain("-c:v");
        expect(args).toContain("libvpx-vp9");
        expect(args).toContain("-b:v");
        expect(args).toContain("1800k");
        expect(args.at(-1)).toBe("/tmp/out.webm");
    });

    it("uses override profile ahead of saved profile", () => {
        const profile = resolvePlaybackProfile({
            savedProfile: {
                codec: "libx264",
                resolution: "1920x1080",
                bitrateKbps: 2500,
                frameRate: 30,
                audioCodec: "aac",
                audioBitrateKbps: 128,
                preset: "quality",
                outputFormat: "mp4"
            },
            overrideProfile: {
                codec: "libvpx-vp9",
                resolution: "1280x720",
                bitrateKbps: 1600,
                frameRate: 24,
                audioCodec: "libopus",
                audioBitrateKbps: 96,
                preset: "fast",
                outputFormat: "webm"
            }
        });

        expect(profile.outputFormat).toBe("webm");
        expect(profile.codec).toBe("libvpx-vp9");
    });

    it("falls back to default profile", () => {
        const profile = resolvePlaybackProfile({
            savedProfile: null,
            overrideProfile: null
        });

        expect(profile).toEqual(DEFAULT_VIDEO_ENCODING_PROFILE);
    });
});

