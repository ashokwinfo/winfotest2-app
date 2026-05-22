import { useState, useRef, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RunScreenshot } from '@/types';

interface ScreenshotGalleryProps {
  screenshots: RunScreenshot[];
  compact?: boolean;
}

export function ScreenshotGallery({ screenshots, compact }: ScreenshotGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeIndex !== null && scrollRef.current) {
      const child = scrollRef.current.children[activeIndex] as HTMLElement;
      child?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeIndex]);

  if (screenshots.length === 0) return null;

  const maxThumbnails = compact ? 3 : screenshots.length;
  const visibleScreenshots = screenshots.slice(0, maxThumbnails);
  const extraCount = screenshots.length - maxThumbnails;

  return (
    <div className={compact ? 'inline-flex gap-1 items-center' : 'space-y-2'}>
      {/* Thumbnails */}
      <div className={`flex gap-1 ${compact ? '' : 'flex-wrap gap-2'}`}>
        {visibleScreenshots.map((ss, i) => (
          <button
            key={ss.id}
            onClick={() => setActiveIndex(i)}
            className={`rounded border border-border bg-muted flex items-center justify-center text-[9px] text-muted-foreground hover:border-primary transition-colors overflow-hidden shrink-0 ${
              compact ? 'w-8 h-5' : 'w-20 h-[50px]'
            }`}
            title={ss.label}
          >
            <img src={ss.url} alt={ss.label} className="w-full h-full object-cover opacity-60" />
          </button>
        ))}
        {extraCount > 0 && (
          <button
            onClick={() => setActiveIndex(maxThumbnails - 1)}
            className={`rounded border border-border bg-muted flex items-center justify-center text-[9px] text-muted-foreground hover:border-primary transition-colors shrink-0 ${
              compact ? 'w-8 h-5' : 'w-20 h-[50px]'
            }`}
          >
            +{extraCount}
          </button>
        )}
      </div>

      {/* Lightbox overlay */}
      {activeIndex !== null && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex flex-col">
          <div className="flex items-center justify-between p-4">
            <div className="text-sm font-medium">
              {screenshots[activeIndex].label}
              <span className="text-muted-foreground ml-2 text-xs">
                {new Date(screenshots[activeIndex].timestamp).toLocaleTimeString()}
              </span>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setActiveIndex(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="flex-1 flex items-center justify-center relative px-12">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 h-10 w-10"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex(Math.max(0, activeIndex - 1))}
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>

            <div ref={scrollRef} className="flex gap-4 overflow-x-auto max-w-full px-4 snap-x snap-mandatory">
              {screenshots.map((ss, i) => (
                <div
                  key={ss.id}
                  className={`shrink-0 snap-center rounded-lg border overflow-hidden transition-all cursor-pointer ${
                    i === activeIndex ? 'border-primary ring-2 ring-primary/20' : 'border-border opacity-40'
                  }`}
                  style={{ width: '600px', height: '375px' }}
                  onClick={() => setActiveIndex(i)}
                >
                  <div className="w-full h-full bg-muted flex items-center justify-center">
                    <img src={ss.url} alt={ss.label} className="w-full h-full object-contain" />
                  </div>
                </div>
              ))}
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 h-10 w-10"
              disabled={activeIndex === screenshots.length - 1}
              onClick={() => setActiveIndex(Math.min(screenshots.length - 1, activeIndex + 1))}
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>

          <div className="p-4 text-center text-xs text-muted-foreground">
            {activeIndex + 1} / {screenshots.length}
          </div>
        </div>
      )}
    </div>
  );
}
