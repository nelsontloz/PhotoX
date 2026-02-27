"use client";

import { useState, useCallback, useRef } from "react";
import { NotificationContext } from "./NotificationContext";
import { Toast } from "./Toast";

export function NotificationProvider({ children }) {
    const [notification, setNotification] = useState(null);
    const [isVisible, setIsVisible] = useState(false);
    const timeoutRef = useRef(null);
    const exitTimeoutRef = useRef(null);

    const hide = useCallback(() => {
        setIsVisible(false);
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
        // Wait for exit animation to complete before removing from DOM
        exitTimeoutRef.current = setTimeout(() => {
            setNotification(null);
        }, 300); // matches duration-300
    }, []);

    const show = useCallback((message, options = {}) => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        if (exitTimeoutRef.current) clearTimeout(exitTimeoutRef.current);

        setNotification({
            message,
            action: options.action,
            duration: options.duration || 5000
        });
        setIsVisible(true);

        if (options.duration !== 0) {
            timeoutRef.current = setTimeout(() => {
                hide();
            }, options.duration || 5000);
        }
    }, [hide]);

    return (
        <NotificationContext.Provider value={{ show, hide }}>
            {children}
            {notification && (
                <Toast
                    message={notification.message}
                    action={notification.action}
                    isVisible={isVisible}
                    onClose={hide}
                />
            )}
        </NotificationContext.Provider>
    );
}
