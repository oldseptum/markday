// ─── Touch gestures (mobile interaction layer) ────────────────────────────────
// Shared, dependency-free helpers. They observe touch events without blocking
// vertical scrolling (horizontal intent is detected first) and are inert on
// devices that never emit touch events, so desktop behavior is untouched.
//
// Мобільний сценарій, який вони складають:
//   • свайп ліворуч/праворуч по сітці — попередній/наступний період
//     (місяць, огляд, міні-календар, тиждень звичок); таймлайн навмисно
//     без цього жесту — він сам скролиться горизонтально;
//   • утримання на задачі — меню статусів (те, що на десктопі права кнопка);
//   • свайп вправо по рядку задачі — виконати / зняти виконання.

// Horizontal swipe over `el` → onPrev (swipe right) / onNext (swipe left)
export function attachSwipeNav(el, onPrev, onNext) {
    let x0, y0, t0, active = false;
    el.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { active = false; return; }
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now(); active = true;
    }, { passive: true });
    el.addEventListener('touchend', e => {
        if (!active) return;
        active = false;
        const t = e.changedTouches[0];
        const dx = t.clientX - x0, dy = t.clientY - y0;
        if (Date.now() - t0 > 600) return;                                   // повільний рух — це не жест
        if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;  // замалий або вертикальний
        (dx > 0 ? onPrev : onNext)();
    }, { passive: true });
}

// Long-press → handler({clientX, clientY}). On Android a long-press already fires a
// native `contextmenu` event (which our elements handle) — the contextmenu listener
// cancels the timer so the menu never opens twice; on iOS, where contextmenu never
// fires, the timer is the only path.
export function attachLongPress(el, handler, ms = 500) {
    let timer = null, x0 = 0, y0 = 0, fired = false;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        const t = e.touches[0];
        x0 = t.clientX; y0 = t.clientY; fired = false;
        timer = setTimeout(() => { timer = null; fired = true; handler({ clientX: x0, clientY: y0 }); }, ms);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
        const t = e.touches[0];
        if (Math.abs(t.clientX - x0) > 10 || Math.abs(t.clientY - y0) > 10) cancel();
    }, { passive: true });
    el.addEventListener('touchend', e => {
        cancel();
        if (fired) e.preventDefault();   // глушить синтетичний click після спрацювання
    }, { passive: false });
    el.addEventListener('touchcancel', cancel, { passive: true });
    el.addEventListener('contextmenu', cancel);
}

// Hold-then-drag: утримання ~450мс "озброює" жест (onStart), після чого рух пальця
// керує колбеками (onMove/onEnd), а нативний скрол глушиться preventDefault'ом.
// Рух ДО озброєння — це звичайне гортання: таймер скасовується і нічого не створюється.
// Використовується таймлайном для створення подій на дотику (миша йде окремим шляхом).
export function attachHoldDrag(el, { accept, onStart, onMove, onEnd, holdMs = 450 }) {
    let timer = null, armed = false, x0 = 0, y0 = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) { cancel(); return; }
        if (accept && !accept(e)) return;
        const t = e.touches[0];
        x0 = t.clientX; y0 = t.clientY; armed = false;
        timer = setTimeout(() => { timer = null; armed = true; onStart(x0, y0); }, holdMs);
    }, { passive: true });
    el.addEventListener('touchmove', e => {
        const t = e.touches[0];
        if (!armed) {
            if (Math.abs(t.clientX - x0) > 10 || Math.abs(t.clientY - y0) > 10) cancel();   // скрол переміг
            return;
        }
        e.preventDefault();   // жест озброєно — гортання більше не втручається
        onMove(t.clientX, t.clientY);
    }, { passive: false });
    const end = () => {
        cancel();
        if (armed) { armed = false; onEnd(); }
    };
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('touchcancel', end, { passive: true });
}

// Swipe the row to the right → onToggle() (complete / un-complete). The row follows
// the finger for feedback; past the threshold it highlights, release commits.
const SWIPE_COMMIT_PX = 64;
export function attachSwipeComplete(row, onToggle) {
    let x0 = 0, y0 = 0, dx = 0, dragging = false;
    row.addEventListener('touchstart', e => {
        if (e.touches.length !== 1) return;
        x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; dx = 0; dragging = false;
    }, { passive: true });
    row.addEventListener('touchmove', e => {
        const t = e.touches[0];
        const mx = t.clientX - x0, my = t.clientY - y0;
        if (!dragging) {
            if (Math.abs(mx) < 14 || Math.abs(mx) < Math.abs(my) * 1.5) return;   // вертикаль → скрол
            dragging = true;
            row.addClass('tc-swiping');
        }
        dx = Math.max(0, mx);   // тягнеться лише вправо
        row.style.transform = `translateX(${Math.min(dx, SWIPE_COMMIT_PX * 1.5)}px)`;
        row.toggleClass('tc-swipe-commit', dx >= SWIPE_COMMIT_PX);
    }, { passive: true });
    const end = async () => {
        if (!dragging) return;
        dragging = false;
        const commit = dx >= SWIPE_COMMIT_PX;
        row.removeClass('tc-swiping');
        row.removeClass('tc-swipe-commit');
        row.style.transform = '';
        // Свайп, що почався, не має перетворюватись на клік по рядку. Браузер шле
        // синтетичний click одразу після touchend (а після відчутного руху — часто
        // взагалі не шле), тож слухач знімається за 400мс: інакше він дожив би до
        // НАСТУПНОГО тапу й зʼїв би його — рядок довелося б тапати двічі.
        const swallow = ev => { ev.stopImmediatePropagation(); ev.preventDefault(); };
        row.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => row.removeEventListener('click', swallow, { capture: true }), 400);
        if (commit) await onToggle();
    };
    row.addEventListener('touchend', end, { passive: true });
    row.addEventListener('touchcancel', end, { passive: true });
}
