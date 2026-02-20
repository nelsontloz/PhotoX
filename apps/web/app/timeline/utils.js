export function isVideoMimeType(mimeType) {
    return typeof mimeType === "string" && mimeType.startsWith("video/");
}

export function formatTimelineDate(value) {
    if (!value) {
        return "Unknown date";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown date";
    }

    return date.toLocaleString();
}

export function formatModalDate(value) {
    if (!value) {
        return "Unknown date";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown date";
    }

    return date.toLocaleDateString(undefined, {
        month: "long",
        day: "numeric",
        year: "numeric"
    });
}

export function formatModalTime(value) {
    if (!value) {
        return "Unknown time";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "Unknown time";
    }

    return date.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
    });
}

export function formatDurationSeconds(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return null;
    }

    const totalSeconds = Math.round(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatDimensions(width, height) {
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
        return null;
    }

    return `${width}x${height}`;
}

export function normalizeDayKey(value) {
    if (!value) {
        return "unknown";
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return "unknown";
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function sectionLabel(dayKey) {
    if (dayKey === "unknown") {
        return {
            title: "Unknown date",
            subtitle: "No timestamp"
        };
    }

    const [year, month, day] = dayKey.split("-").map((part) => Number(part));
    const date = new Date(year, month - 1, day);
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffDays = Math.round((todayStart.getTime() - date.getTime()) / 86400000);

    const subtitle = date.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric"
    });

    if (diffDays === 0) {
        return { title: "Today", subtitle };
    }

    if (diffDays === 1) {
        return { title: "Yesterday", subtitle };
    }

    return {
        title: date.toLocaleDateString(undefined, {
            month: "long",
            day: "numeric",
            year: "numeric"
        }),
        subtitle
    };
}
