"use client";

import { FilmstripThumb } from "../FilmstripThumb";

export function LightboxFilmstrip({ items, activeMediaId, onSelect }) {
    return (
        <div className="h-20 flex items-center justify-center px-6 gap-2 bg-gradient-to-t from-black/40 to-transparent">
            <div className="flex gap-1 overflow-x-auto no-scrollbar py-2">
                {items.map((item) => (
                    <FilmstripThumb
                        key={item.id}
                        mediaId={item.id}
                        isActive={item.id === activeMediaId}
                        onSelect={() => onSelect(item.id)}
                    />
                ))}
            </div>
        </div>
    );
}
