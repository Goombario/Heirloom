'use client';

/* eslint-disable no-restricted-syntax -- Diagnostic-only overlay: intentional raw
   DOM probing (querySelector on the nav/.app-scroll owned by other components,
   createElement probes for env(safe-area-inset-*) and svh/dvh/lvh). Not migratable
   to refs; this component renders nothing unless ?diag=1 is present. */

/**
 * On-screen viewport diagnostic, gated behind `?diag=1`. Prints the live
 * env(safe-area-inset-*) values (via a probe element's computed padding), the
 * resolved px height of the small/large/dynamic viewport units, window +
 * visualViewport metrics, and the nav / .app-scroll rects — updating on scroll
 * and resize. This is the tool that cracked the original mobile-chrome diagnosis;
 * it renders nothing unless the URL carries ?diag=1. Not user-facing.
 */

import { useEffect, useState } from 'react';

type Snap = Record<string, string | number>;

export default function DiagOverlay() {
  const [on, setOn] = useState(false);
  const [snap, setSnap] = useState<Snap>({});

  useEffect(() => {
    if (!/[?&]diag=1(&|$)/.test(window.location.search)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOn(true);

    // Probe for env(safe-area-inset-*): read back its computed padding.
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top) env(safe-area-inset-right) ' +
      'env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);

    // Probes for the three viewport-unit flavours.
    const mk = (h: string) => {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;top:0;left:0;width:1px;height:${h};visibility:hidden;pointer-events:none;`;
      document.body.appendChild(d);
      return d;
    };
    const dvh = mk('100dvh'), lvh = mk('100lvh'), svh = mk('100svh');

    const round = (n: number) => Math.round(n);
    const update = () => {
      const ps = getComputedStyle(probe);
      const navEl = document.querySelector('nav');
      const nav = navEl?.getBoundingClientRect();
      const navBg = navEl ? getComputedStyle(navEl).backgroundColor : 'n/a';
      const bodyBg = getComputedStyle(document.body).backgroundColor;
      const scroll = document.querySelector('.app-scroll')?.getBoundingClientRect();
      const vv = window.visualViewport;
      setSnap({
        'inset TRBL':
          `${ps.paddingTop}/${ps.paddingRight}/${ps.paddingBottom}/${ps.paddingLeft}`,
        'innerHeight': window.innerHeight,
        'vv h/offTop': vv ? `${round(vv.height)} / ${round(vv.offsetTop)}` : 'n/a',
        'svh/dvh/lvh': `${round(svh.getBoundingClientRect().height)}/${round(
          dvh.getBoundingClientRect().height,
        )}/${round(lvh.getBoundingClientRect().height)}`,
        'nav top→bot': nav ? `${round(nav.top)} → ${round(nav.bottom)}` : 'n/a',
        'nav bg': navBg,
        'body bg': bodyBg,
        'scroll bot/scrH':
          `${scroll ? round(scroll.bottom) : 'n/a'} / ${round(screen.height)}`,
        'tint': document.documentElement.dataset.tint || '(none)',
      });
    };

    update();
    const opts = { passive: true } as const;
    window.addEventListener('scroll', update, opts);
    window.addEventListener('resize', update, opts);
    window.visualViewport?.addEventListener('resize', update, opts);
    window.visualViewport?.addEventListener('scroll', update, opts);
    document.querySelector('.app-scroll')?.addEventListener('scroll', update, opts);

    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      [probe, dvh, lvh, svh].forEach((el) => el.remove());
    };
  }, []);

  if (!on) return null;

  return (
    <div
      className="m-1.5 px-2 py-1.5 text-[#0f0] bg-[rgba(0,0,0,0.82)] border border-[#0f0] rounded-[6px]"
      style={{
        position: 'fixed',
        top: 'env(safe-area-inset-top, 0px)',
        left: 0,
        zIndex: 99999,
        font: '10px/1.35 ui-monospace, monospace',
        pointerEvents: 'none',
        whiteSpace: 'pre',
      }}
    >
      {Object.entries(snap)
        .map(([k, v]) => `${k.padEnd(14)}${v}`)
        .join('\n')}
    </div>
  );
}
