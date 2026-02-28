/** @type {import('next').NextConfig} */
const devApiProxyMode = process.env.NEXT_DEV_API_PROXY_MODE || "compose";
const devApiProxyTarget = process.env.NEXT_DEV_API_PROXY_TARGET || "http://localhost:8088";

function buildComposeServiceRewrites() {
    return [
        { source: "/api/v1/auth/:path*", destination: "http://auth-service:3000/api/v1/auth/:path*" },
        { source: "/api/v1/me", destination: "http://auth-service:3000/api/v1/me" },
        { source: "/api/v1/admin/:path*", destination: "http://auth-service:3000/api/v1/admin/:path*" },
        { source: "/api/v1/uploads/:path*", destination: "http://ingest-service:3000/api/v1/uploads/:path*" },
        { source: "/api/v1/library/:path*", destination: "http://library-service:3000/api/v1/library/:path*" },
        { source: "/api/v1/media/:path*", destination: "http://library-service:3000/api/v1/media/:path*" },
        { source: "/api/v1/albums/:path*", destination: "http://album-sharing-service:3000/api/v1/albums/:path*" },
        { source: "/api/v1/search/:path*", destination: "http://search-service:3000/api/v1/search/:path*" },
        { source: "/api/v1/worker/:path*", destination: "http://worker-service:3000/api/v1/worker/:path*" },
        { source: "/api/v1/ml/:path*", destination: "http://ml-service:8000/api/v1/ml/:path*" }
    ];
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    async rewrites() {
        if (process.env.NODE_ENV !== "development") {
            return [];
        }

        if (devApiProxyMode === "compose") {
            return buildComposeServiceRewrites();
        }

        return [
            {
                source: "/api/v1/:path*",
                destination: `${devApiProxyTarget}/api/v1/:path*`
            }
        ];
    }
};

export default nextConfig;
