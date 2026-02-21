import { Spinner } from "./Spinner";

/**
 * Full-screen centered spinner for session validation states.
 *
 * Props:
 *  - label: string (default "Validating session...")
 */
export function SessionLoadingScreen({ label = "Validating session..." }) {
    return (
        <div className="flex h-screen w-full items-center justify-center bg-background-light dark:bg-background-dark">
            <Spinner size="lg" label={label} />
        </div>
    );
}
