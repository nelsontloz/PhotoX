"use client";

import { createContext, useContext } from "react";

export const NotificationContext = createContext({
    show: () => { },
    hide: () => { }
});

export const useNotification = () => useContext(NotificationContext);
