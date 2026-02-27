import {
    createEmptyVideoEncodingForm,
    getAudioCodecForFormat,
    getCodecForFormat,
    isVideoEncodingSectionVisible,
    profileToVideoEncodingForm,
    toVideoEncodingProfilePayload,
    validateVideoEncodingForm
} from "../../app/settings/utils";

describe("settings video encoding utils", () => {
    it("maps persisted profile to form strings", () => {
        const form = profileToVideoEncodingForm({
            codec: "libx264",
            resolution: "1920x1080",
            bitrateKbps: 2500,
            frameRate: 30,
            audioCodec: "aac",
            audioBitrateKbps: 128,
            preset: "quality",
            outputFormat: "mp4"
        });

        expect(form.bitrateKbps).toBe("2500");
        expect(form.audioBitrateKbps).toBe("128");
        expect(form.outputFormat).toBe("mp4");
    });

    it("validates a correct webm profile form", () => {
        const issues = validateVideoEncodingForm({
            codec: "libvpx-vp9",
            resolution: "1280x720",
            bitrateKbps: "1800",
            frameRate: "30",
            audioCodec: "libopus",
            audioBitrateKbps: "96",
            preset: "balanced",
            outputFormat: "webm"
        });

        expect(issues).toEqual([]);
    });

    it("rejects incompatible codec and format combinations", () => {
        const issues = validateVideoEncodingForm({
            codec: "libx264",
            resolution: "1280x720",
            bitrateKbps: "1800",
            frameRate: "30",
            audioCodec: "aac",
            audioBitrateKbps: "96",
            preset: "balanced",
            outputFormat: "webm"
        });

        expect(issues[0]).toContain("codec must be libvpx-vp9");
    });

    it("builds payload with integer numeric fields", () => {
        const payload = toVideoEncodingProfilePayload({
            codec: "libx264",
            resolution: "1920x1080",
            bitrateKbps: "2500",
            frameRate: "30",
            audioCodec: "aac",
            audioBitrateKbps: "128",
            preset: "quality",
            outputFormat: "mp4"
        });

        expect(payload.bitrateKbps).toBe(2500);
        expect(payload.frameRate).toBe(30);
        expect(payload.audioBitrateKbps).toBe(128);
    });

    it("exposes codec defaults by output format", () => {
        expect(getCodecForFormat("webm")).toBe("libvpx-vp9");
        expect(getAudioCodecForFormat("mp4")).toBe("aac");
    });

    it("shows video encoding section only for admin users", () => {
        expect(isVideoEncodingSectionVisible({ isAdmin: true })).toBe(true);
        expect(isVideoEncodingSectionVisible({ isAdmin: false })).toBe(false);
    });

    it("creates an empty default form shape", () => {
        const form = createEmptyVideoEncodingForm();
        expect(form).toEqual({
            codec: "libvpx-vp9",
            resolution: "1280x720",
            bitrateKbps: "1800",
            frameRate: "30",
            audioCodec: "libopus",
            audioBitrateKbps: "96",
            preset: "balanced",
            outputFormat: "webm"
        });
    });
});
