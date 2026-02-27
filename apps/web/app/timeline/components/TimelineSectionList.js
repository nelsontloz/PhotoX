import { TimelineThumbnail } from "./TimelineThumbnail";

export function TimelineSectionList({ sections, selectionMode, selectedIds, onSelectItem, onOpenItem }) {
  return sections.map((section) => (
    <section key={section.key} className="mb-10">
      <div className="flex items-end gap-3 mb-4 sticky top-0 bg-background-light/95 dark:bg-background-dark/95 backdrop-blur z-30 py-2 -mx-4 px-4 sm:-mx-8 sm:px-8 transition-all">
        <h2 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">{section.title}</h2>
        {section.subtitle && (
          <span className="text-xs sm:text-sm font-medium text-slate-500 mb-1 whitespace-nowrap">{section.subtitle}</span>
        )}
        {section.subtitle && (
          <span className="text-xs sm:text-sm font-medium text-slate-500 mb-1 whitespace-nowrap">{section.subtitle}</span>
        )}
      </div>

      <div className="masonry-grid">
        {section.items.map((item) => (
          <TimelineThumbnail
            key={item.id}
            item={item}
            selectionMode={selectionMode}
            isSelected={selectedIds.has(item.id)}
            onSelect={() => onSelectItem(item.id)}
            onOpen={() => onOpenItem(item.id)}
          />
        ))}
      </div>
    </section>
  ));
}
