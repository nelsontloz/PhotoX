import {
    fetchWorkerVideoEncodingProfile,
    saveWorkerVideoEncodingProfile
} from "../../lib/api";
import { clearSession, writeSession } from "../../lib/session";

function jsonResponse(status, payload) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            "content-type": "application/json"
        }
    });
}

describe("settings api integration", () => {
    beforeEach(() => {
        clearSession();
        vi.restoreAllMocks();
        writeSession({
            accessToken: "access-token",
            refreshToken: "refresh-token",
            expiresIn: 3600,
            user: {
                id: "usr_admin",
                email: "admin@example.com",
                isAdmin: true,
                isActive: true
            }
        });
    });

    it("fetches and saves the video encoding profile through worker settings api", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                jsonResponse(200, {
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
                })
            )
            .mockResolvedValueOnce(
                jsonResponse(200, {
                    profile: {
                        codec: "libx264",
                        resolution: "1920x1080",
                        bitrateKbps: 2500,
                        frameRate: 30,
                        audioCodec: "aac",
                        audioBitrateKbps: 128,
                        preset: "quality",
                        outputFormat: "mp4"
                    }
                })
            );

        vi.stubGlobal("fetch", fetchMock);

        const current = await fetchWorkerVideoEncodingProfile();
        expect(current.profile.outputFormat).toBe("webm");

        const saved = await saveWorkerVideoEncodingProfile({
            codec: "libx264",
            resolution: "1920x1080",
            bitrateKbps: 2500,
            frameRate: 30,
            audioCodec: "aac",
            audioBitrateKbps: 128,
            preset: "quality",
            outputFormat: "mp4"
        });

        expect(saved.profile.outputFormat).toBe("mp4");
        expect(fetchMock.mock.calls[0][0]).toContain("/worker/settings/video-encoding");
        expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    });
});

