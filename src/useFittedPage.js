import { useLayoutEffect, useRef, useState } from 'react';

// Keep the selected item on screen when the window or its surrounding chrome changes size.
export function useFittedPage(count, { reserve = 56, columns = 1, resetKey = '', useMaxHeight = false } = {}) {
  const listRef = useRef(null);
  const [capacity, setCapacity] = useState(1);
  const [anchor, setAnchor] = useState(0);
  const tallest = useRef({ key: '', height: 0 });
  useLayoutEffect(() => {
    const list = listRef.current;
    const viewport = list?.closest('.editor-scroll, .workspace, .detail-sheet');
    if (!viewport || !list.children.length) return;
    function measure() {
      const rect = list.getBoundingClientRect();
      if (!rect.width) return;
      const key = [list.clientWidth, resetKey].join('/');
      const row = Math.max(...Array.from(list.children, child => child.offsetHeight));
      if (!row) return;
      const height = Math.max(row, tallest.current.key === key ? tallest.current.height : 0);
      tallest.current = { key, height };
      const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
      const budget = useMaxHeight ? parseFloat(getComputedStyle(viewport).maxHeight)
        : viewport.getBoundingClientRect().bottom - rect.top;
      const available = budget - reserve;
      const across = columns === 'grid' ? getComputedStyle(list).gridTemplateColumns.split(' ').length : columns;
      setCapacity(Math.max(1, Math.floor((available + gap) / (height + gap))) * across);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(list);
    if (useMaxHeight) window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      if (useMaxHeight) window.removeEventListener('resize', measure);
    };
  });
  const page = Math.min(Math.floor(anchor / capacity) + 1, Math.max(1, Math.ceil(count / capacity)));
  const start = (page - 1) * capacity;
  return { listRef, page, capacity, start, slice: items => items.slice(start, start + capacity),
    select: setAnchor, pager: { currentPage: page, pageSize: capacity, total: count,
      size: 'small', hideOnSinglePage: true, onPageChange: next => setAnchor((next - 1) * capacity) } };
}
